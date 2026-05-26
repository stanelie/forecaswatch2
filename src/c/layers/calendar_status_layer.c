#include "calendar_status_layer.h"
#include "battery_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/memory_log.h"
#include "c/services/watch_services.h"

#define BATTERY_W 29
#define BATTERY_H 10
// circular battery uses a square frame sized to fit a readable arc + GOTHIC_14 text
#ifdef PBL_PLATFORM_EMERY
#define BATTERY_CIRCULAR_SIZE 26
#else
#define BATTERY_CIRCULAR_SIZE 22
#endif
#define PADDING 4
#define MONTH_FONT_OFFSET 7
#define ICON_SLOT_1 GRect(PADDING, 0, 10, 10)
#define ICON_SLOT_2 GRect(PADDING * 2 + 10, 0, 10, 10)
// emery: center icons in the taller status row.
#define STATUS_ICON_Y(bounds_h, icon_h) (((bounds_h) - (icon_h)) / 2)
#define BATTERY_Y(bounds_h) (((bounds_h) - BATTERY_H) / 2)

static Layer *s_calendar_status_layer;
static char s_calendar_month_text[20]; // "Wednesday Sep 30" + null
static GBitmap *s_mute_bitmap;
static GBitmap *s_bt_bitmap;
static GBitmap *s_bt_disconnect_bitmap;
static GColor s_bt_palette[2];
static GColor s_bt_disconnect_palette[2];
static GColor s_mute_palette[2];

static GRect month_text_rect(GRect bounds, GFont font) {
#ifdef PBL_PLATFORM_EMERY
    // emery: vertically center month text using measured height to match taller status bar.
    const GRect measure_box = GRect(0, 0, bounds.size.w, bounds.size.h);
    const GSize text_size = graphics_text_layout_get_content_size(
        s_calendar_month_text, font, measure_box, GTextOverflowModeFill, GTextAlignmentCenter);
    const int text_y = ((bounds.size.h - text_size.h) / 2) - 5;
    return GRect(0, text_y, bounds.size.w, text_size.h + 3);
#else
    (void)font;
    return GRect(0, 0, bounds.size.w, bounds.size.h);
#endif
}

static void draw_month_text(GContext *ctx, GRect bounds) {
    const GFont month_font = config_status_date_font(bounds.size.h);
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(
        ctx,
        s_calendar_month_text,
        month_font,
        month_text_rect(bounds, month_font),
        GTextOverflowModeFill,
        GTextAlignmentCenter,
        NULL);
}

static void draw_bitmap(GContext *ctx, GBitmap *bitmap, GRect frame) {
    graphics_context_set_compositing_mode(ctx, GCompOpSet);
    graphics_draw_bitmap_in_rect(ctx, bitmap, frame);
    graphics_context_set_compositing_mode(ctx, GCompOpAssign);
}

static void ensure_mute_bitmap_loaded(void) {
    if (!s_mute_bitmap) {
        s_mute_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_MUTE);
        s_mute_palette[0] = GColorWhite;
        s_mute_palette[1] = GColorClear;
        gbitmap_set_palette(s_mute_bitmap, s_mute_palette, false);
    }
}

static void ensure_bt_bitmap_loaded(void) {
    if (!s_bt_bitmap) {
        s_bt_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BT_CONNECT);
        s_bt_palette[0] = PBL_IF_COLOR_ELSE(GColorPictonBlue, GColorWhite);
        s_bt_palette[1] = GColorClear;
        gbitmap_set_palette(s_bt_bitmap, s_bt_palette, false);
    }
}

static void ensure_bt_disconnect_bitmap_loaded(void) {
    if (!s_bt_disconnect_bitmap) {
        s_bt_disconnect_bitmap = gbitmap_create_with_resource(RESOURCE_ID_IMAGE_BT_DISCONNECT);
        s_bt_disconnect_palette[0] = PBL_IF_COLOR_ELSE(GColorRed, GColorWhite);
        s_bt_disconnect_palette[1] = GColorClear;
        gbitmap_set_palette(s_bt_disconnect_bitmap, s_bt_disconnect_palette, false);
    }
}

static void maybe_unload_calendar_status_bitmaps(bool show_qt, bool connected) {
    bool show_bt = connected && g_config->show_bt;
    bool show_bt_disconnect = !connected && g_config->show_bt_disconnect;

    if (!show_qt && s_mute_bitmap) {
        gbitmap_destroy(s_mute_bitmap);
        s_mute_bitmap = NULL;
    }

    if (!show_bt && s_bt_bitmap) {
        gbitmap_destroy(s_bt_bitmap);
        s_bt_bitmap = NULL;
    }

    if (!show_bt_disconnect && s_bt_disconnect_bitmap) {
        gbitmap_destroy(s_bt_disconnect_bitmap);
        s_bt_disconnect_bitmap = NULL;
    }
}

static void calendar_status_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    bool show_qt = show_qt_icon();
    bool connected = connection_service_peek_pebble_app_connection();
    int icon_x = show_qt ? ICON_SLOT_2.origin.x : ICON_SLOT_1.origin.x;
    bool show_bt = connected && g_config->show_bt;
    bool show_bt_disconnect = !connected && g_config->show_bt_disconnect;

    maybe_unload_calendar_status_bitmaps(show_qt, connected);

    if (show_qt) {
        ensure_mute_bitmap_loaded();
        draw_bitmap(ctx, s_mute_bitmap, GRect(ICON_SLOT_1.origin.x, STATUS_ICON_Y(bounds.size.h, ICON_SLOT_1.size.h),
                                              ICON_SLOT_1.size.w, ICON_SLOT_1.size.h));
    }

    if (show_bt) {
        ensure_bt_bitmap_loaded();
        draw_bitmap(ctx, s_bt_bitmap, GRect(icon_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    } else if (show_bt_disconnect) {
        ensure_bt_disconnect_bitmap_loaded();
        draw_bitmap(ctx, s_bt_disconnect_bitmap, GRect(icon_x, STATUS_ICON_Y(bounds.size.h, 10), 10, 10));
    }

    draw_month_text(ctx, bounds);
}

void calendar_status_layer_create(Layer* parent_layer, GRect frame) {
    MemoryHeapProbe probe = MEMORY_HEAP_PROBE_START("calendar_status_layer_create");

    s_calendar_status_layer = layer_create(frame);
    MEMORY_HEAP_PROBE_SAMPLE("after_layer_create", &probe);

    GRect bounds = layer_get_bounds(s_calendar_status_layer);
    int w = bounds.size.w;

    // Set up bluetooth handler
    connection_service_subscribe((ConnectionHandlers) {
        .pebble_app_connection_handler = bluetooth_callback
    });
    MEMORY_HEAP_PROBE_SAMPLE("after_connection_subscribe", &probe);

    calendar_status_layer_refresh();

    layer_set_update_proc(s_calendar_status_layer, calendar_status_update_proc);
    MEMORY_HEAP_PROBE_SAMPLE("after_update_proc_set", &probe);

    int bat_size = g_config->battery_circular ? BATTERY_CIRCULAR_SIZE : 0;
    int bat_w = bat_size ? bat_size : BATTERY_W;
    int bat_h = bat_size ? bat_size : BATTERY_H;
    int bat_y = bat_size ? (bounds.size.h - bat_size) / 2 : BATTERY_Y(bounds.size.h);
    battery_layer_create(s_calendar_status_layer,
                         GRect(w - bat_w - PADDING, bat_y, bat_w, bat_h));
    MEMORY_HEAP_PROBE_SAMPLE("after_battery_layer_create", &probe);

    layer_add_child(parent_layer, s_calendar_status_layer);
    MEMORY_HEAP_PROBE_SAMPLE("after_parent_child_added", &probe);

    MEMORY_LOG_HEAP("after_calendar_status_layer_create");
    MEMORY_HEAP_PROBE_LOG_MIN(&probe);
}

void bluetooth_icons_refresh(bool connected) {
    (void)connected;
    layer_mark_dirty(s_calendar_status_layer);
}

void bluetooth_callback(bool connected) {
    bluetooth_icons_refresh(connected);
    if (!connected && g_config->vibe)
        vibes_double_pulse();
}

bool show_qt_icon() {
    return g_config->show_qt && quiet_time_is_active();
}

void status_icons_refresh() {
    layer_mark_dirty(s_calendar_status_layer);

    // Ensure bt icons are correct at start
    bluetooth_icons_refresh(connection_service_peek_pebble_app_connection());
}

void calendar_status_layer_refresh() {
    struct tm tm_now = watch_services_localtime();
    char day_name[12];
    char month_abbr[8];
    strftime(day_name, sizeof(day_name), "%a", &tm_now);
    strftime(month_abbr, sizeof(month_abbr), "%b", &tm_now);
    snprintf(s_calendar_month_text, sizeof(s_calendar_month_text),
             "%s %s %d", day_name, month_abbr, tm_now.tm_mday);
    status_icons_refresh();
}

void calendar_status_layer_set_hidden(bool hidden) {
    layer_set_hidden(s_calendar_status_layer, hidden);
}

void calendar_status_layer_destroy() {
    MEMORY_LOG_HEAP("calendar_status_layer_destroy:before");
    battery_layer_destroy();
    if (s_mute_bitmap) {
        gbitmap_destroy(s_mute_bitmap);
        s_mute_bitmap = NULL;
    }
    if (s_bt_bitmap) {
        gbitmap_destroy(s_bt_bitmap);
        s_bt_bitmap = NULL;
    }
    if (s_bt_disconnect_bitmap) {
        gbitmap_destroy(s_bt_disconnect_bitmap);
        s_bt_disconnect_bitmap = NULL;
    }
    layer_destroy(s_calendar_status_layer);
    MEMORY_LOG_HEAP("calendar_status_layer_destroy:after");
}
