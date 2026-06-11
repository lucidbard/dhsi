// Tiny assertion harness for headless-browser test pages.
// Pages call check(name, fn) for each assertion, then report().
// The runner greps the dumped DOM for "RESULT|PASS" / "RESULT|FAIL".
const results = [];

function check(name, fn) {
  try {
    results.push((fn() ? "PASS " : "FAIL ") + name);
  } catch (e) {
    results.push("FAIL " + name + " (" + e.message + ")");
  }
}

function report() {
  const failed = results.some((r) => !r.startsWith("PASS"));
  document.body.insertAdjacentText(
    "beforeend",
    "RESULT|" + (failed ? "FAIL" : "PASS") + "|" + results.join("|")
  );
}
