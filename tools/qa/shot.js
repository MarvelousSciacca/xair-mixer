ObjC.import('Cocoa'); ObjC.import('WebKit');
// uso: shot.js URL OUT W H attesa1 [JS da eseguire separati da ";;" con attesa 1.5 s tra uno e l'altro]
function run(argv) {
  const [url, out] = argv; const w = Number(argv[2] || 1280), h = Number(argv[3] || 800), wait = Number(argv[4] || 4);
  const steps = (argv[5] || '').split(';;').filter(Boolean);
  $.NSApplication.sharedApplication;
  const rect = $.NSMakeRect(0, 0, w, h);
  const win = $.NSWindow.alloc.initWithContentRectStyleMaskBackingDefer(rect, 0, $.NSBackingStoreBuffered, false);
  win.setFrameOrigin($.NSMakePoint(0, 0)); win.alphaValue = 0.01; win.ignoresMouseEvents = true; win.level = 3;
  const cfg = $.WKWebViewConfiguration.alloc.init;
  const us = $.WKUserScript.alloc.initWithSourceInjectionTimeForMainFrameOnly("window.__errs=[];addEventListener('error',e=>__errs.push((e.message||'')+' @'+(e.filename||'').split('/').pop()+':'+e.lineno));addEventListener('unhandledrejection',e=>__errs.push('rej '+(e.reason&&e.reason.stack||e.reason)));", 0, true);
  cfg.userContentController.addUserScript(us);
  const wv = $.WKWebView.alloc.initWithFrameConfiguration(rect, cfg);
  win.contentView = wv; win.orderFront(null);
  wv.loadRequest($.NSURLRequest.requestWithURL($.NSURL.URLWithString(url)));
  const until = d => $.NSRunLoop.currentRunLoop.runUntilDate($.NSDate.dateWithTimeIntervalSinceNow(d));
  until(wait);
  for (const js of steps) { wv.evaluateJavaScriptCompletionHandler(js, (r, e) => {}); until(1.5); }
  let report = null;
  if (argv[6]) { wv.evaluateJavaScriptCompletionHandler(argv[6], (r, e) => { report = r ? ObjC.unwrap(r) : ('ERR ' + (e ? ObjC.unwrap(e.localizedDescription) : '')); }); for (let i = 0; i < 30 && report === null; i++) until(0.1); }
  let done = false;
  wv.takeSnapshotWithConfigurationCompletionHandler($.WKSnapshotConfiguration.alloc.init, img => {
    const rep = $.NSBitmapImageRep.imageRepWithData(img.TIFFRepresentation);
    rep.representationUsingTypeProperties($.NSBitmapImageFileTypePNG, $()).writeToFileAtomically(out, true);
    done = true;
  });
  for (let i = 0; i < 50 && !done; i++) until(0.1);
  return (done ? 'ok' : 'timeout') + (report !== null ? '\n' + report : '');
}
