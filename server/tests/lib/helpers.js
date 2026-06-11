const green  = '\x1b[32m';
const red    = '\x1b[31m';
const yellow = '\x1b[33m';
const cyan   = '\x1b[36m';
const bold   = '\x1b[1m';
const reset  = '\x1b[0m';

function pass(label, msg) {
  console.log(`${green}${bold}PASS${reset} ${cyan}[${label}]${reset} ${msg}`);
}

function fail(label, msg, details) {
  console.error(`${red}${bold}FAIL${reset} ${cyan}[${label}]${reset} ${msg}`);
  if (details !== undefined) {
    const str = typeof details === 'object' ? JSON.stringify(details, null, 2) : String(details);
    str.split('\n').forEach((line) => console.error(`     ${line}`));
  }
}

function step(msg) {
  console.log(`${cyan}....${reset} ${msg}`);
}

function warn(msg) {
  console.log(`${yellow}WARN${reset} ${msg}`);
}

function dump(label, obj) {
  console.log(`${yellow}DATA${reset} ${cyan}[${label}]${reset}`);
  console.log(JSON.stringify(obj, null, 2));
}

function header(title) {
  const bar = '─'.repeat(60);
  console.log(`\n${bold}${bar}${reset}`);
  console.log(`${bold}  ${title}${reset}`);
  console.log(`${bold}${bar}${reset}\n`);
}

function summary(passed, failed) {
  console.log('');
  if (failed === 0) {
    console.log(`${green}${bold}ALL TESTS PASSED${reset} (${passed} passed)`);
  } else {
    console.log(`${red}${bold}TESTS FAILED${reset}: ${failed} failed, ${passed} passed`);
  }
}

module.exports = { pass, fail, step, warn, dump, header, summary };
