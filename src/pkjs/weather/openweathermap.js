var WeatherProvider = require('./provider.js');
var request = WeatherProvider.request;

var OpenWeatherMapProvider = function(apiKey) {
    this._super.call(this);
    this.name = 'OpenWeatherMap';
    this.id = 'openweathermap';
    this.apiKey = apiKey;
    this.weatherDataCache = null;
    console.log('Constructed with ' + apiKey);
};

OpenWeatherMapProvider.prototype = Object.create(WeatherProvider.prototype);
OpenWeatherMapProvider.prototype.constructor = OpenWeatherMapProvider;
OpenWeatherMapProvider.prototype._super = WeatherProvider;

OpenWeatherMapProvider.prototype.withOwmResponse = function(lat, lon, callback, onFailure) {
    var url = 'https://api.openweathermap.org/data/3.0/onecall?appid=' + this.apiKey + '&lat=' + lat + '&lon=' + lon + '&units=imperial&exclude=alerts,minutely';

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
                onFailure({ stage: 'provider_data', code: 'owm_parse_error' });
                return;
            }
            if (!weatherData || !weatherData.hourly || !weatherData.current || !weatherData.daily) {
                onFailure({ stage: 'provider_data', code: 'owm_missing_fields' });
                return;
            }
            console.log('Found timezone: ' + weatherData.timezone);
            // cache weather data (use same request for sun events and weather forecast)
            this.weatherDataCache = weatherData;
            callback(weatherData);
        }).bind(this),
        function(error) {
            console.log('[!] OpenWeatherMap request failed: ' + JSON.stringify(error));
            onFailure({ stage: 'provider_data', code: 'owm_' + error.code });
        }
    );
};

OpenWeatherMapProvider.prototype.withWeatherData = function(lat, lon, callback, onFailure) {
    if (this.weatherDataCache === null) {
        this.withOwmResponse(lat, lon, function(owmResponse) {
            callback(owmResponse);
        }, onFailure);
    }
    else {
        callback(this.weatherDataCache);
    }
};

// ============== IMPORTANT OVERRIDE ================
OpenWeatherMapProvider.prototype.withSunEvents = function(lat, lon, callback, onFailure) {
    console.log('This is the overridden implementation of withSunEvents');
    this.withOwmResponse(lat, lon, (function(owmResponse) {
        var days = owmResponse.daily;
        var sunEvents;
        var now;
        var nextSunEvents;
        var next24HourSunEvents;

        if (!Array.isArray(days) || days.length < 2) {
            onFailure({ stage: 'sun_events', code: 'owm_missing_daily' });
            return;
        }

        sunEvents = [
            { type: 'sunrise', date: new Date(days[0].sunrise * 1000) },
            { type: 'sunset', date: new Date(days[0].sunset * 1000) },
            { type: 'sunrise', date: new Date(days[1].sunrise * 1000) },
            { type: 'sunset', date: new Date(days[1].sunset * 1000) }
        ];
        now = new Date();
        nextSunEvents = sunEvents.filter(function(sunEvent) {
            return sunEvent.date > now;
        });
        next24HourSunEvents = nextSunEvents.slice(0, 2);
        console.log('The next ' + sunEvents[0].type + ' is at ' + sunEvents[0].date.toTimeString());
        console.log('The next ' + sunEvents[1].type + ' is at ' + sunEvents[1].date.toTimeString());
        callback(next24HourSunEvents);
    }).bind(this), onFailure);
};

function owmConditionCode(id, icon) {
    var isNight = icon && icon[icon.length - 1] === 'n';
    if (id >= 200 && id < 300) return 8; // thunder
    if (id >= 300 && id < 400) return 5; // drizzle
    if (id >= 500 && id < 600) return 6; // rain
    if (id >= 600 && id < 700) return 7; // snow
    if (id >= 700 && id < 800) return 4; // fog/atmosphere
    if (id === 800) return isNight ? 1 : 0; // clear day/night
    if (id === 801 || id === 802) return 2; // partly cloudy
    if (id >= 803) return 3; // cloudy
    return 9; // N/A
}

OpenWeatherMapProvider.prototype.withProviderData = function(lat, lon, force, onSuccess, onFailure) {
    // onSuccess expects that this.hasValidData() will be true
    console.log('This is the overridden implementation of withProviderData');
    this.withWeatherData(lat, lon, (function(weatherData) {
        this.tempTrend = weatherData.hourly.map(function(entry) {
            return entry.temp;
        });
        this.precipTrend = weatherData.hourly.map(function(entry) {
            return entry.pop;
        });
        this.startTime = weatherData.hourly[0].dt;
        this.currentTemp = weatherData.current.temp;
        var currentWeather = weatherData.current.weather && weatherData.current.weather[0];
        this.conditionCode = currentWeather
            ? owmConditionCode(currentWeather.id, currentWeather.icon)
            : 9;
        onSuccess();
    }).bind(this), onFailure);
};

module.exports = OpenWeatherMapProvider;
