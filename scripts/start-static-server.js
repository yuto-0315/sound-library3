const express = require('express');
const path = require('path');
const port = process.env.PORT || 5000;

const app = express();
const buildDir = path.resolve(__dirname, '..', 'build');

app.use(express.static(buildDir));
app.get('*', (req, res) => {
  res.sendFile(path.join(buildDir, 'index.html'));
});

app.listen(port, () => {
  console.log(`Static server running at http://localhost:${port}`);
});
