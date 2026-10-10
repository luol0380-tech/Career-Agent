'use strict';

var fs = require('fs');
var path = require('path');
var vm = require('vm');

function loadRevisePrompt(appDir) {
  var file = path.join(appDir, 'lib', 'revise-prompt.js');
  var code = fs.readFileSync(file, 'utf8');
  var ctx = vm.createContext({ console: console });
  vm.runInContext(code, ctx, { filename: 'revise-prompt.js' });
  if (!ctx.CareerAgent || !ctx.CareerAgent.lib || !ctx.CareerAgent.lib.revisePrompt) {
    throw new Error('无法加载 revise-prompt');
  }
  return ctx.CareerAgent.lib.revisePrompt;
}

module.exports = { loadRevisePrompt: loadRevisePrompt };
