#pragma once

#include <pebble.h>

void current_weather_layer_create(Layer *parent_layer, GRect frame);
void current_weather_layer_refresh(void);
void current_weather_layer_set_hidden(bool hidden);
void current_weather_layer_destroy(void);
