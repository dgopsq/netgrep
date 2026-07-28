const path = require('node:path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  entry: './src/index.js',
  mode: 'development',
  output: {
    filename: 'main.js',
    path: path.resolve(__dirname, 'dist'),
  },
  experiments: {
    asyncWebAssembly: true,
  },
  devServer: {
    static: ['assets', 'dist'],
    // `http2: true` was removed here, not merely deprecated away: it routes
    // webpack-dev-server 4 through `spdy`, which calls
    // `process.binding('http_parser')` — removed from Node years ago. On Node
    // 24 the dev server dies at startup with "No such module: http_parser".
    //
    // The original intent was presumably to multiplex the 67 concurrent
    // fixture fetches past HTTP/1.1's 6-connection limit. Over localhost that
    // costs a little latency and nothing else.
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/index.html',
    }),
  ],
};
