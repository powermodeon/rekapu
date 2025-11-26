const path = require('path');
const CopyWebpackPlugin = require('copy-webpack-plugin');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: 'development',
  devtool: 'cheap-module-source-map',
  entry: {
    popup: './src/popup/index.tsx',
    background: './src/background/background.ts',
    contentScript: './src/content/contentScript.ts',
    dashboard: './src/dashboard/index.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: '[name].js',
    clean: true,
  },
  module: {
    rules: [
      {
        test: /\.tsx?$/,
        use: [
          {
            loader: 'ts-loader',
            options: {
              configFile: 'tsconfig.json',
            },
          },
        ],
        exclude: [/node_modules/, /website/],
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
      {
        test: /\.json$/,
        type: 'json',
      },
      {
        test: /\.wasm$/,
        type: 'asset/resource',
      },
    ],
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
    fallback: {
      "fs": false,
      "path": false,
      "crypto": false
    }
  },
  plugins: [
    new CopyWebpackPlugin({
      patterns: [
        { from: 'src/manifest.json', to: 'manifest.json' },
        { from: 'src/blocked.html', to: 'blocked.html' },
        { from: 'src/blocked.js', to: 'blocked.js' },
        { from: 'src/dashboard.html', to: 'dashboard.html' },
        { from: 'src/_locales/', to: '_locales/', noErrorOnMissing: false },
        { from: 'src/vendor/marked.js', to: 'vendor/marked.js' },
        { from: 'src/styles/', to: 'styles/', noErrorOnMissing: true },
        { from: 'src/vendor/', to: 'vendor/', noErrorOnMissing: true },
        { from: 'src/icons/', to: 'icons/', noErrorOnMissing: false },
        { from: 'node_modules/sql.js/dist/sql-wasm.wasm', to: 'sql-wasm.wasm' },
      ],
    }),
    new HtmlWebpackPlugin({
      template: './src/popup/popup.html',
      filename: 'popup.html',
      chunks: ['popup'],
    }),
  ],
}; 