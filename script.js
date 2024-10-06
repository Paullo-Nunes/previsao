//previnir o efeito de atualização da página no formulário

document.querySelector('#pesquisar').addEventListener('submit', async (Event) => {
    Event.preventDefault();

    const cityName = document.querySelector('#city_name').value; //capturando a cidade e fazendo a validação.
    if (!cityName) {
        document.querySelector('.infos').classList.add('none');
        document.querySelector('.title').classList.add('none');
        showAlert('Você precisa digitar o nome de uma cidade...');
        return
        

    };

    const api = 'b00a925214a1dbde0ee0b27c7454701d';
    const apiUrl = `https://api.openweathermap.org/data/2.5/weather?q=${encodeURI(cityName)}&appid=${api}&units=metric&lang=pt_br`;


    const results = await fetch(apiUrl);
    const json = await results.json();

    if (json.cod === 200) {

        showInfos({
            city: json.name,
            country: json.sys.country,
            temp: json.main.temp,
            tempMax: json.main.temp_max,
            tempMin: json.main.temp_min,
            description: json.weather[0].description,
            tempIcon: json.weather[0].icon,
            windSpeed: json.wind.speed,
            umidity: json.main.humidity

        })

    } else {
        document.querySelector('.infos').classList.add('none');
        document.querySelector('.title').classList.add('none');
        showAlert(`
            Não foi possível localizar...
            <img src="./images/undraw_location_search_re_ttoj.svg" alt="imagem de erro de localização">
            
        `)
        
       
    }

});

function showInfos(json) {
    showAlert('');

    document.querySelector('#weather').classList.add('show');

    document.querySelector('.title').innerHTML = `${json.city}, ${json.country}`;

    document.querySelector('.temp-value').innerHTML = `${json.temp.toFixed(0).toString().replace('.', ',')}ºc`;

    document.querySelector('.temp-description').innerHTML = `${json.description}`;

    document.querySelector('#temp-img').setAttribute('src', `https://openweathermap.org/img/wn/${json.tempIcon}@2x.png`);

    document.querySelector('#temp-max').innerHTML = `${json.tempMax.toFixed(0).toString().replace('.', ',')}ºc`;

    document.querySelector('#temp-min').innerHTML = `${json.tempMin.toFixed(0).toString().replace('.', ',')}ºc`;

    document.querySelector('#umidity').innerHTML = `${json.umidity}%`;

    document.querySelector('#wind').innerHTML = `${json.windSpeed.toFixed(1)}km/h`;

};

//função de mostrar o alerta

function showAlert(msg) {
    document.querySelector('#alert').innerHTML = msg;

};



