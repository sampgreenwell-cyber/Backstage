# ${{ values.name }}

${{ values.description }}

## Run locally
npm install
npm start

## Docker
docker build -t ${{ values.name }} .
docker run -p ${{ values.port }}:${{ values.port }} ${{ values.name }}
