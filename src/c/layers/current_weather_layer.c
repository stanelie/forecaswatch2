#include "current_weather_layer.h"
#include "c/appendix/config.h"
#include "c/appendix/persist.h"

#define ICON_SIZE 20
#define NUM_CONDITIONS 10

static const uint32_t s_condition_resources[NUM_CONDITIONS] = {
    RESOURCE_ID_IMAGE_WEATHER_CLEAR_DAY,
    RESOURCE_ID_IMAGE_WEATHER_CLEAR_NIGHT,
    RESOURCE_ID_IMAGE_WEATHER_PARTLY_CLOUDY,
    RESOURCE_ID_IMAGE_WEATHER_CLOUDY,
    RESOURCE_ID_IMAGE_WEATHER_FOG,
    RESOURCE_ID_IMAGE_WEATHER_DRIZZLE,
    RESOURCE_ID_IMAGE_WEATHER_RAIN,
    RESOURCE_ID_IMAGE_WEATHER_SNOW,
    RESOURCE_ID_IMAGE_WEATHER_THUNDER,
    RESOURCE_ID_IMAGE_WEATHER_NA,
};

static Layer *s_layer;
static GBitmap *s_icon_bitmap;
static int s_loaded_condition = -1;
static char s_temp_text[8]; // "-999°" + null

static void ensure_icon_loaded(int condition) {
    if (condition < 0 || condition >= NUM_CONDITIONS)
        condition = NUM_CONDITIONS - 1;
    if (s_loaded_condition == condition)
        return;
    if (s_icon_bitmap) {
        gbitmap_destroy(s_icon_bitmap);
        s_icon_bitmap = NULL;
    }
    s_icon_bitmap = gbitmap_create_with_resource(s_condition_resources[condition]);
    s_loaded_condition = condition;
}

static GFont choose_font(int available_h) {
    if (available_h >= 42)
        return fonts_get_system_font(FONT_KEY_BITHAM_42_BOLD);
    if (available_h >= 28)
        return fonts_get_system_font(FONT_KEY_GOTHIC_28_BOLD);
    if (available_h >= 24)
        return fonts_get_system_font(FONT_KEY_GOTHIC_24_BOLD);
    if (available_h >= 18)
        return fonts_get_system_font(FONT_KEY_GOTHIC_18_BOLD);
    return fonts_get_system_font(FONT_KEY_GOTHIC_14_BOLD);
}

static void current_weather_update_proc(Layer *layer, GContext *ctx) {
    GRect bounds = layer_get_bounds(layer);
    int h = bounds.size.h;
    int w = bounds.size.w;

    int condition = persist_get_condition_code();
    int temp = config_localize_temp(persist_get_current_temp());
    ensure_icon_loaded(condition);

    GFont font = choose_font(h);
    snprintf(s_temp_text, sizeof(s_temp_text), "%d\xc2\xb0", temp); // °

    // Measure rendered text size so we can compute equal horizontal padding.
    GSize text_size = graphics_text_layout_get_content_size(
        s_temp_text, font, GRect(0, 0, w, h), GTextOverflowModeFill, GTextAlignmentLeft);
    int text_w = text_size.w;
    int text_h = text_size.h;

    GRect icon_bb = s_icon_bitmap
        ? gbitmap_get_bounds(s_icon_bitmap)
        : GRect(0, 0, ICON_SIZE, ICON_SIZE);
    int icon_w = icon_bb.size.w;
    int icon_h = icon_bb.size.h;

    // Divide leftover space into 3 equal pads: [pad][icon][pad][temp][pad]
    int pad = (w - icon_w - text_w) / 3;
    if (pad < 0) pad = 0;

    // Draw icon at natural size, vertically centered.
    if (s_icon_bitmap) {
        int icon_x = pad;
        int icon_y = (h - icon_h) / 2 - 4;
        if (icon_y < 0) icon_y = 0;
        graphics_draw_bitmap_in_rect(ctx, s_icon_bitmap,
            GRect(icon_x, icon_y, icon_w, icon_h));
    }

    // Draw temperature, shifted up by half text height to compensate for font descent.
    int text_x = pad + icon_w + pad;
    int text_y = (h - text_h) / 2 - text_h / 2;
    if (text_y < 0) text_y = 0;
    graphics_context_set_text_color(ctx, GColorWhite);
    graphics_draw_text(ctx, s_temp_text, font,
        GRect(text_x, text_y, w - text_x - pad, text_h),
        GTextOverflowModeFill, GTextAlignmentLeft, NULL);
}

void current_weather_layer_create(Layer *parent_layer, GRect frame) {
    s_layer = layer_create(frame);
    layer_set_update_proc(s_layer, current_weather_update_proc);
    layer_add_child(parent_layer, s_layer);
}

void current_weather_layer_refresh(void) {
    if (s_layer)
        layer_mark_dirty(s_layer);
}

void current_weather_layer_set_hidden(bool hidden) {
    if (s_layer)
        layer_set_hidden(s_layer, hidden);
}

void current_weather_layer_destroy(void) {
    if (s_icon_bitmap) {
        gbitmap_destroy(s_icon_bitmap);
        s_icon_bitmap = NULL;
    }
    s_loaded_condition = -1;
    if (s_layer) {
        layer_destroy(s_layer);
        s_layer = NULL;
    }
}
