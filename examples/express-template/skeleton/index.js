const express = require('express');
const app = express();
const port = process.env.PORT || ${{ values.port }};

app.get('/', (req, res) => {
  res.send('Hello from ${{ values.name }}!');
});

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.listen(port, () => {
  console.log(`${{ values.name }} listening on port ${port}`);
});
