const { defineConfig } = require('@vue/cli-service')
module.exports = defineConfig({
  chainWebpack: config => {
    config
      .plugin('html')
      .tap(args => {
        args[0].title = "Whiss SSH";
        return args;
      });
  },
  transpileDependencies: true,
});
