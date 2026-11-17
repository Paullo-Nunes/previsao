# Projeto Previsão do Tempo

<img src="./images/previsao-tempo.png" alt="Tela inicial do aplicativo de previsão do tempo">

## Descrição

Aplicativo para consultar temperatura atual, temperaturas máxima e mínima, umidade e velocidade do vento.

## Executar localmente

Requer Node.js 20.6 ou superior. A chave da OpenWeather fica no servidor, não no navegador:

1. Crie uma chave nova no painel da OpenWeather. Revogue a chave antiga se ela já foi publicada.
2. Na pasta do projeto, copie `.env.example` para `.env` e coloque a chave no valor de `OPENWEATHER_API_KEY`. Nunca envie `.env` ao GitHub.
3. Inicie o servidor:

   ```powershell
   npm start
   ```

4. Abra `http://localhost:3000` e busque uma cidade. Para testar o endpoint diretamente, acesse `http://localhost:3000/api/weather?city=Recife`.

O Node.js serve o site e o endpoint `/api/weather` na mesma origem. O endpoint valida a cidade, consulta as condições atuais e a previsão de 5 dias da OpenWeather no servidor e não retorna a chave ao navegador. Máxima e mínima são calculadas agrupando as previsões de 3 em 3 horas no dia local da cidade; para hoje, consideram apenas os períodos restantes. Se não houver mais períodos para hoje, a interface identifica a data do próximo dia disponível.

O endpoint limita cada IP a 10 consultas por minuto e mantém respostas em cache por 5 minutos (até 500 cidades). Esses controles usam memória local do processo; em hospedagem com várias instâncias, use armazenamento compartilhado e configure corretamente o proxy confiável para identificar o IP do cliente. Evite confiar diretamente em `X-Forwarded-For`.

## Publicação

Este projeto agora requer hospedagem que execute Node.js; GitHub Pages sozinho serve apenas arquivos estáticos e não executará o backend. Publique a pasta em um serviço com suporte a Node.js, defina `OPENWEATHER_API_KEY` nas variáveis de ambiente do serviço e use `npm start` como comando de inicialização. Não cadastre a chave em arquivos do repositório.

## Testes

Execute os testes automatizados sem precisar de uma chave ou conexão com a OpenWeather:

```powershell
npm test
```

## Tecnologias

- HTML, CSS e JavaScript
- Node.js
- OpenWeather API
