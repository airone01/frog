/* eslint-disable unicorn/prefer-node-protocol */
const path = require('path');
// Const TerserPlugin = require('terser-webpack-plugin');

module.exports = {
  mode: 'development',
  target: 'node12.22',
  entry: './src/index.ts',
  output: {
    path: path.resolve(__dirname, './build'),
    publicPath: '/',
    filename: 'frog.js',
  },
  resolve: {
    extensions: ['.tsx', '.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts?$/,
        use: 'ts-loader',
        exclude: /node_modules/,
      },
    ],
  },
};
// Optimization: {
//   minimizer: [
//     new TerserPlugin(),
//   ],
// },
