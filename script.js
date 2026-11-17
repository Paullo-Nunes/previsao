const form = document.querySelector('#pesquisar');
const cityInput = document.querySelector('#city_name');
const weatherEl = document.querySelector('#weather');
const alertEl = document.querySelector('#alert');

function showAlert(message) {
    alertEl.textContent = message;
}

async function searchWeather(event) {
    event.preventDefault();

    const cityName = cityInput.value.trim();

    if (!cityName) {
        showAlert('Você precisa digitar o nome de uma cidade.');
        return;
    }

    try {
        const query = new URLSearchParams({ city: cityName });
        const response = await fetch(`/api/weather?${query}`);
        const data = await response.json();

        if (!response.ok) {
            throw new Error(data.error || 'Não foi possível buscar a cidade.');
        }

        renderWeather(data);
    } catch (error) {
        console.error('Weather lookup failed:', error);
        showAlert(error instanceof Error ? error.message : 'Não foi possível buscar a previsão.');
    }
}

function renderWeather(data) {
    if (
        typeof data.city !== 'string'
        || typeof data.country !== 'string'
        || !Number.isFinite(data.temperature)
        || !Number.isFinite(data.temperatureMax)
        || !Number.isFinite(data.temperatureMin)
        || !/^\d{4}-\d{2}-\d{2}$/.test(data.forecastDate || '')
        || !Number.isFinite(data.humidity)
        || typeof data.description !== 'string'
        || !/^\d{2}[dn]$/.test(data.icon || '')
        || !Number.isFinite(data.windSpeedKmh)
    ) {
        throw new Error('A resposta do serviço de previsão é inválida.');
    }

    const temperatureFormat = new Intl.NumberFormat('pt-BR', {
        maximumFractionDigits: 0
    });
    const windFormat = new Intl.NumberFormat('pt-BR', {
        maximumFractionDigits: 1,
        minimumFractionDigits: 1
    });
    const forecastDate = new Intl.DateTimeFormat('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        timeZone: 'UTC'
    }).format(new Date(`${data.forecastDate}T12:00:00Z`));

    document.querySelector('.title').textContent = `${data.city}, ${data.country}`;
    document.querySelector('.temp-value').textContent = `${temperatureFormat.format(data.temperature)}ºc`;
    document.querySelector('.temp-description').textContent = data.description;
    document.querySelector('#temp-img').src = `https://openweathermap.org/img/wn/${data.icon}@2x.png`;
    document.querySelector('#temp-max').textContent = `${temperatureFormat.format(data.temperatureMax)}ºc`;
    document.querySelector('#temp-min').textContent = `${temperatureFormat.format(data.temperatureMin)}ºc`;
    document.querySelector('#temp-max-label').textContent = `Temp. max. (${forecastDate})`;
    document.querySelector('#temp-min-label').textContent = `Temp. min. (${forecastDate})`;
    document.querySelector('#umidity').textContent = `${temperatureFormat.format(data.humidity)}%`;
    document.querySelector('#wind').textContent = `${windFormat.format(data.windSpeedKmh)} km/h`;

    weatherEl.classList.add('show');
    showAlert('');
}

form.addEventListener('submit', searchWeather);
