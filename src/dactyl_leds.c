/*
 * Status LEDs for the Dactyl Manuform.
 *
 * Left half (central, USB):
 *   - red:   Caps Lock, driven by ZMK's zmk,indicator-leds (see the left overlay).
 *   - blue:  on while the mode layer (AOE2) is active. It is read from the keymap
 *            itself, so it can never drift from the real layer state.
 *   - green: alerts about the right half. Slow blink while it is disconnected,
 *            a double blink every few seconds while its battery is low, and
 *            1-3 blinks with its battery level each time it connects.
 *
 * Right half (peripheral, battery):
 *   - red:   battery level on boot (2 slow / 4 medium / 6 fast blinks), two quick
 *            blinks when it links with the left half, one long blink when it
 *            loses the link, and a short blip every 30 s while the battery is low.
 */

#include <zephyr/kernel.h>
#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include <zephyr/drivers/led.h>
#include <zephyr/sys/atomic.h>

#include <zmk/event_manager.h>
#include <zmk/battery.h>
#include <zmk/events/battery_state_changed.h>

#if IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)
#include <zephyr/bluetooth/conn.h>
#include <zmk/keymap.h>
#include <zmk/events/layer_state_changed.h>
#define ALERT_NODE DT_ALIAS(dactyl_led_green)
#define MODE_NODE DT_ALIAS(dactyl_led_blue)
#else
#include <zmk/events/split_peripheral_status_changed.h>
#define ALERT_NODE DT_ALIAS(dactyl_led_red)
#endif

BUILD_ASSERT(DT_NODE_EXISTS(ALERT_NODE),
             "Missing dactyl-led-green (left) or dactyl-led-red (right) alias in the overlay");

#define BATTERY_LOW CONFIG_DACTYL_LEDS_BATTERY_LOW

// Delay before the first indication so battery and split link have time to come up.
#define STARTUP_DELAY_MS 1500
// Pause between two queued blink sequences so they read as separate messages.
#define SEQUENCE_GAP_MS 400

struct blink {
    uint16_t on_ms;
    uint16_t off_ms;
    uint8_t count;
};

// A pattern repeated for as long as a condition holds (e.g. right half disconnected).
struct background {
    struct blink blink;
    uint32_t pause_ms;
};

static const struct device *alert_dev = DEVICE_DT_GET(DT_PARENT(ALERT_NODE));
static const uint32_t alert_idx = DT_NODE_CHILD_IDX(ALERT_NODE);

K_MSGQ_DEFINE(blink_queue, sizeof(struct blink), 8, 4);

// Central: the right half is connected. Peripheral: linked with the left half.
static atomic_t link_up;
static atomic_t battery_low;

static void enqueue(struct blink b) { k_msgq_put(&blink_queue, &b, K_NO_WAIT); }

// An empty blink only wakes the thread so it re-evaluates the background pattern.
static void wake(void) { enqueue((struct blink){0}); }

static void play(const struct blink *b) {
    for (int i = 0; i < b->count; i++) {
        led_on(alert_dev, alert_idx);
        k_msleep(b->on_ms);
        led_off(alert_dev, alert_idx);
        k_msleep(b->off_ms);
    }
}

static void set_battery_low(uint8_t level) {
    bool low = level <= BATTERY_LOW;
    if (atomic_set(&battery_low, low) != low) {
        wake();
    }
}

#if IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)

static bool current_background(struct background *bg) {
    if (!atomic_get(&link_up)) {
        *bg = (struct background){.blink = {150, 0, 1}, .pause_ms = 1850};
        return true;
    }
    if (atomic_get(&battery_low)) {
        *bg = (struct background){.blink = {80, 150, 2}, .pause_ms = 5000};
        return true;
    }
    return false;
}

static void startup_indication(void) {}

#else

static bool current_background(struct background *bg) {
    if (atomic_get(&battery_low)) {
        *bg = (struct background){.blink = {40, 0, 1}, .pause_ms = 30000};
        return true;
    }
    return false;
}

static void startup_indication(void) {
#if IS_ENABLED(CONFIG_ZMK_BATTERY_REPORTING)
    uint8_t level = zmk_battery_state_of_charge();
    if (level >= 50) {
        play(&(struct blink){500, 500, 2});
    } else if (level > BATTERY_LOW) {
        play(&(struct blink){150, 150, 4});
    } else {
        play(&(struct blink){50, 50, 6});
    }
    k_msleep(SEQUENCE_GAP_MS);
#endif
}

#endif

static void alert_thread(void *p1, void *p2, void *p3) {
    k_msleep(STARTUP_DELAY_MS);
    startup_indication();

    while (true) {
        struct background bg;
        bool has_bg = current_background(&bg);
        struct blink b;

        if (k_msgq_get(&blink_queue, &b, has_bg ? K_MSEC(bg.pause_ms) : K_FOREVER) == 0) {
            if (b.count > 0) {
                play(&b);
                k_msleep(SEQUENCE_GAP_MS);
            }
            continue;
        }
        play(&bg.blink);
    }
}

K_THREAD_DEFINE(dactyl_leds_thread, 1024, alert_thread, NULL, NULL, NULL,
                K_LOWEST_APPLICATION_THREAD_PRIO, 0, 0);

#if IS_ENABLED(CONFIG_ZMK_SPLIT_ROLE_CENTRAL)

// Show the right half's battery level once, on the first reading after it connects.
static atomic_t level_pending;

static void peripheral_connected(struct bt_conn *conn, uint8_t err) {
    struct bt_conn_info info;
    // Connections where we are the GAP central are to the right half, not to a host.
    if (err || bt_conn_get_info(conn, &info) || info.role != BT_CONN_ROLE_CENTRAL) {
        return;
    }
    atomic_set(&level_pending, true);
    atomic_set(&link_up, true);
    wake();
}

static void peripheral_disconnected(struct bt_conn *conn, uint8_t reason) {
    struct bt_conn_info info;
    if (bt_conn_get_info(conn, &info) || info.role != BT_CONN_ROLE_CENTRAL) {
        return;
    }
    atomic_set(&link_up, false);
    atomic_set(&battery_low, false);
    wake();
}

BT_CONN_CB_DEFINE(dactyl_leds_conn_cb) = {
    .connected = peripheral_connected,
    .disconnected = peripheral_disconnected,
};

static void update_mode_led(void) {
#if DT_NODE_EXISTS(MODE_NODE)
    const struct device *dev = DEVICE_DT_GET(DT_PARENT(MODE_NODE));
    const uint32_t idx = DT_NODE_CHILD_IDX(MODE_NODE);

    if (zmk_keymap_layer_active(CONFIG_DACTYL_LEDS_MODE_LAYER)) {
        led_on(dev, idx);
    } else {
        led_off(dev, idx);
    }
#endif
}

static int dactyl_leds_listener(const zmk_event_t *eh) {
    if (as_zmk_layer_state_changed(eh)) {
        update_mode_led();
        return ZMK_EV_EVENT_BUBBLE;
    }

#if IS_ENABLED(CONFIG_ZMK_SPLIT_BLE_CENTRAL_BATTERY_LEVEL_FETCHING)
    const struct zmk_peripheral_battery_state_changed *ev =
        as_zmk_peripheral_battery_state_changed(eh);
    // ZMK reports level 0 when the right half disconnects; that is not a reading.
    if (ev && ev->state_of_charge > 0) {
        if (atomic_set(&level_pending, false)) {
            uint8_t level = ev->state_of_charge;
            enqueue((struct blink){250, 250, level >= 50 ? 3 : (level > BATTERY_LOW ? 2 : 1)});
        }
        set_battery_low(ev->state_of_charge);
    }
#endif

    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(dactyl_leds, dactyl_leds_listener);
ZMK_SUBSCRIPTION(dactyl_leds, zmk_layer_state_changed);
#if IS_ENABLED(CONFIG_ZMK_SPLIT_BLE_CENTRAL_BATTERY_LEVEL_FETCHING)
ZMK_SUBSCRIPTION(dactyl_leds, zmk_peripheral_battery_state_changed);
#endif

#else

static int dactyl_leds_listener(const zmk_event_t *eh) {
    const struct zmk_split_peripheral_status_changed *link_ev =
        as_zmk_split_peripheral_status_changed(eh);
    if (link_ev) {
        if (atomic_set(&link_up, link_ev->connected) != link_ev->connected) {
            enqueue(link_ev->connected ? (struct blink){80, 120, 2} : (struct blink){1000, 0, 1});
        }
        return ZMK_EV_EVENT_BUBBLE;
    }

#if IS_ENABLED(CONFIG_ZMK_BATTERY_REPORTING)
    const struct zmk_battery_state_changed *battery_ev = as_zmk_battery_state_changed(eh);
    if (battery_ev) {
        set_battery_low(battery_ev->state_of_charge);
    }
#endif

    return ZMK_EV_EVENT_BUBBLE;
}

ZMK_LISTENER(dactyl_leds, dactyl_leds_listener);
ZMK_SUBSCRIPTION(dactyl_leds, zmk_split_peripheral_status_changed);
#if IS_ENABLED(CONFIG_ZMK_BATTERY_REPORTING)
ZMK_SUBSCRIPTION(dactyl_leds, zmk_battery_state_changed);
#endif

#endif
