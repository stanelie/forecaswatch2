var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;

var WundergroundProvider = function() {
    this._super.call(this);
    this.name = 'Weather Underground';
    this.id = 'wunderground';
};

WundergroundProvider.prototype = Object.create(WeatherProvider.prototype);
WundergroundProvider.prototype.constructor = WundergroundProvider;
WundergroundProvider.prototype._super = WeatherProvider;

WundergroundProvider.prototype.withWundergroundForecast = function(lat, lon, apiKey, callback, onFailure) {
    // callback(wundergroundResponse)
    var url = 'https://api.weather.com/v1/geocode/' + lat + '/' + lon + '/forecast/hourly/48hour.json?apiKey=' + apiKey + '&language=en-US';

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
                onFailure({ stage: 'provider_data', code: 'wu_forecast_parse_error' });
                return;
            }

            if (!weatherData || !Array.isArray(weatherData.forecasts) || weatherData.forecasts.length === 0) {
                onFailure({ stage: 'provider_data', code: 'wu_forecast_missing_fields' });
                return;
            }

            callback(weatherData.forecasts);
        },
        function(error) {
            onFailure({ stage: 'provider_data', code: 'wu_forecast_' + error.code });
        }
    );
};

// Maps Weather Underground icon codes (0-47) to our 10 condition codes.
function wuIconToCondition(iconCode) {
    if (typeof iconCode !== 'number' || iconCode < 0 || iconCode > 47) return 9;
    if (iconCode <= 1)  return 9; // tornado
    if (iconCode <= 4)  return 8; // thunder
    if (iconCode <= 7)  return 7; // rain/snow mix
    if (iconCode <= 9)  return 5; // drizzle
    if (iconCode === 10) return 6; // freezing rain
    if (iconCode <= 12) return 6; // showers
    if (iconCode <= 16) return 7; // snow
    if (iconCode === 17) return 8; // thunder
    if (iconCode === 18) return 6; // sleet
    if (iconCode <= 22) return 4; // fog/haze/smoke
    if (iconCode <= 25) return 9; // wind/blustery/cold
    if (iconCode === 26 || iconCode === 27 || iconCode === 28) return 3; // cloudy
    if (iconCode === 29 || iconCode === 30) return 2; // partly cloudy
    if (iconCode === 31 || iconCode === 33) return 1; // clear night
    if (iconCode === 32 || iconCode === 34 || iconCode === 36) return 0; // sunny/clear
    if (iconCode === 35 || (iconCode >= 37 && iconCode <= 39)) return 8; // thunder
    if (iconCode === 40) return 6; // rain
    if (iconCode >= 41 && iconCode <= 43) return 7; // snow
    if (iconCode === 45 || iconCode === 47) return 8; // thunder
    if (iconCode === 46) return 7; // rain/snow
    return 9;
}

WundergroundProvider.prototype.withWundergroundCurrent = function(lat, lon, apiKey, callback, onFailure) {
    // callback(temperature, iconCode)
    var url = 'https://api.weather.com/v3/wx/observations/current?language=en-US&units=e&format=json'
        + '&apiKey=' + apiKey
        + '&geocode=' + lat + ',' + lon;

    console.log('Requesting ' + url);

    request(
        url,
        'GET',
        (function(response) {
            var weatherData;
            try {
                weatherData = JSON.parse(response);
            }
            catch (ex) {
                onFailure({ stage: 'provider_data', code: 'wu_current_parse_error' });
                return;
            }

            if (!weatherData || typeof weatherData.temperature !== 'number') {
                onFailure({ stage: 'provider_data', code: 'wu_current_missing_fields' });
                return;
            }

            callback(weatherData.temperature, weatherData.iconCode);
        }).bind(this),
        function(error) {
            onFailure({ stage: 'provider_data', code: 'wu_current_' + error.code });
        }
    );
};

WundergroundProvider.prototype.clearApiKey = function() {
    localStorage.removeItem('wundergroundApiKey');
    console.log('Cleared API key');
};

WundergroundProvider.prototype.withApiKey = function(callback, onFailure) {
    // callback(apiKey)

    var apiKey = localStorage.getItem('wundergroundApiKey');
    var url = 'https://www.wunderground.com/';

    if (apiKey === null) {
        console.log('Fetching Weather Underground API key');

        request(
            url,
            'GET',
            function(response) {
                var match = response.match(/observations\/current\?apiKey=([a-z0-9]*)/);
                if (!match || !match[1]) {
                    onFailure({ stage: 'provider_data', code: 'wu_api_key_not_found' });
                    return;
                }

                apiKey = match[1];
                localStorage.setItem('wundergroundApiKey', apiKey);
                console.log('Fetched Weather Underground API key: ' + apiKey);
                callback(apiKey);
            },
            function(error) {
                onFailure({ stage: 'provider_data', code: 'wu_api_key_' + error.code });
            }
        );
    }
    else {
        console.log('Using saved API key for Weather Underground');
        callback(apiKey);
    }
};

// ============== IMPORTANT OVERRIDE ================

WundergroundProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    // onSuccess expects that this.hasValidData() will be true

    if (force) {
        // In case the API key becomes invalid
        console.log('Clearing Weather Underground API key for forced update');
        this.clearApiKey();
    }

    this.withApiKey((function(apiKey) {
        this.withWundergroundCurrent(lat, lon, apiKey, (function(currentTemp, iconCode) {
            this.withWundergroundForecast(lat, lon, apiKey, (function(forecast) {
                this.tempTrend = forecast.map(function(entry) {
                    return entry.temp;
                });
                this.precipTrend = forecast.map(function(entry) {
                    return entry.pop / 100.0;
                });
                this.startTime = forecast[0].fcst_valid;
                this.currentTemp = currentTemp;
                this.conditionCode = wuIconToCondition(iconCode);
                onSuccess();
            }).bind(this), onFailure);
        }).bind(this), onFailure);
    }).bind(this), onFailure);
};

module.exports = WundergroundProvider;
