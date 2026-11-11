var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;

// API docs: https://open-meteo.com/en/docs

var FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';

// Variables requested from the forecast endpoint. To expose a new data point,
// append it here and map it in withProviderData().
var CURRENT_VARS = ['temperature_2m', 'weather_code', 'is_day'];
var HOURLY_VARS = ['temperature_2m', 'precipitation_probability', 'precipitation'];

var OpenMeteoProvider = function() {
    this._super.call(this);
    this.name = 'Open-Meteo';
    this.id = 'openmeteo';
};

OpenMeteoProvider.prototype = Object.create(WeatherProvider.prototype);
OpenMeteoProvider.prototype.constructor = OpenMeteoProvider;
OpenMeteoProvider.prototype._super = WeatherProvider;

/**
 * Map an Open-Meteo WMO weather code to one of the watchface condition codes.
 *
 * Open-Meteo reports conditions as WMO 4677 codes, which cover more cases than
 * the ten icons the watch ships. Codes that have no icon of their own collapse
 * onto the nearest one (for example freezing drizzle onto drizzle).
 *
 * @param {*} code WMO weather code from the current block.
 * @param {*} isDay Open-Meteo is_day flag (1 during the day, 0 at night).
 * @returns {number} Condition code within [0,9]; 9 (N/A) when unmapped.
 */
function wmoToCondition(code, isDay) {
    // is_day is only needed to pick between the clear-day and clear-night icons.
    // Treat a missing flag as daytime rather than failing the whole fetch.
    var night = isDay === 0;

    if (!isFiniteNumber(code)) return 9;

    if (code === 0) return night ? 1 : 0;        // clear sky
    if (code === 1) return night ? 1 : 0;        // mainly clear
    if (code === 2) return 2;                    // partly cloudy
    if (code === 3) return 3;                    // overcast
    if (code === 45 || code === 48) return 4;    // fog, depositing rime fog
    if (code >= 51 && code <= 57) return 5;      // drizzle, incl. freezing drizzle
    if (code >= 61 && code <= 67) return 6;      // rain, incl. freezing rain
    if (code >= 71 && code <= 77) return 7;      // snow fall, snow grains
    if (code >= 80 && code <= 82) return 6;      // rain showers
    if (code === 85 || code === 86) return 7;    // snow showers
    if (code >= 95 && code <= 99) return 8;      // thunderstorm, incl. hail

    return 9;
}

/**
 * Build the forecast request URL in the units the watch payload expects.
 *
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @param {number} hours Number of hourly entries starting at the current hour.
 * @returns {string} Request URL.
 */
function buildForecastUrl(lat, lon, hours) {
    return FORECAST_URL
        + '?latitude=' + lat
        + '&longitude=' + lon
        + '&current=' + CURRENT_VARS.join(',')
        + '&hourly=' + HOURLY_VARS.join(',')
        + '&temperature_unit=fahrenheit'
        + '&precipitation_unit=inch'
        + '&timeformat=unixtime'
        + '&forecast_hours=' + hours;
}

/**
 * Check that a value is a finite number.
 *
 * @param {*} value Value to check.
 * @returns {boolean} True for finite numbers.
 */
function isFiniteNumber(value) {
    return typeof value === 'number' && isFinite(value);
}

/**
 * Replace missing entries (null for some models/regions) with zero.
 *
 * @param {Array<number|null>} values Hourly values.
 * @returns {number[]} Values with non-numbers replaced by 0.
 */
function numbersOrZero(values) {
    return values.map(function(value) {
        return isFiniteNumber(value) ? value : 0;
    });
}

/**
 * Check that the response carries every variable the watchface needs.
 *
 * current.temperature_2m is validated by the finite check in withProviderData().
 *
 * @param {Object} weatherData Parsed Open-Meteo response.
 * @returns {boolean} True when the hourly block is complete.
 */
function hasRequestedFields(weatherData) {
    var hourly;

    if (!weatherData || !weatherData.current || !weatherData.hourly) {
        return false;
    }

    hourly = weatherData.hourly;
    if (!Array.isArray(hourly.time) || hourly.time.length === 0) {
        return false;
    }

    return HOURLY_VARS.every(function(name) {
        return Array.isArray(hourly[name]) && hourly[name].length === hourly.time.length;
    });
}

/**
 * Request and validate the Open-Meteo forecast.
 *
 * @param {number|string} lat Latitude.
 * @param {number|string} lon Longitude.
 * @param {Function} callback Called with the parsed response.
 * @param {Function} onFailure Called with a {stage, code} failure.
 * @returns {void}
 */
OpenMeteoProvider.prototype.withOpenMeteoResponse = function(lat, lon, callback, onFailure) {
    var url = buildForecastUrl(lat, lon, this.numEntries);

    console.log('Requesting ' + url);

    request(
        url,
        'GET',
        function(response) {
            var weatherData;
            try {
                weatherData = JSON.parse(response);
            }
            catch (ex) {
                onFailure({ stage: 'provider_data', code: 'om_parse_error' });
                return;
            }

            if (!hasRequestedFields(weatherData)) {
                onFailure({ stage: 'provider_data', code: 'om_missing_fields' });
                return;
            }

            callback(weatherData);
        },
        function(error) {
            console.log('[!] Open-Meteo request failed: ' + JSON.stringify(error));
            onFailure({ stage: 'provider_data', code: 'om_' + error.code });
        }
    );
};

// ============== IMPORTANT OVERRIDE ================

OpenMeteoProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    // onSuccess expects that this.hasValidData() will be true
    this.withOpenMeteoResponse(lat, lon, (function(weatherData) {
        var current = weatherData.current;
        var hourly = weatherData.hourly;

        // A missing temperature would otherwise round to a bogus 0°F.
        if (!isFiniteNumber(current.temperature_2m) || !hourly.temperature_2m.every(isFiniteNumber)) {
            onFailure({ stage: 'provider_data', code: 'om_missing_fields' });
            return;
        }

        this.tempTrend = hourly.temperature_2m;
        this.precipTrend = numbersOrZero(hourly.precipitation_probability).map(function(percent) {
            return percent / 100.0;
        });
        this.precipAmountTrend = numbersOrZero(hourly.precipitation);
        this.startTime = hourly.time[0];
        this.currentTemp = current.temperature_2m;
        this.conditionCode = wmoToCondition(current.weather_code, current.is_day);
        onSuccess();
    }).bind(this), onFailure);
};

module.exports = OpenMeteoProvider;
