/**
 * The Blackout Drive — Help Panel
 * In-app quick-start guide and troubleshooting.
 * Fully offline — no links to the internet.
 */
'use strict';

let _helpPanelOpen = false;

function toggleHelpPanel(force) {
  const panel = document.getElementById('helpPanel');
  if (!panel) return;
  const opening = (force === undefined) ? !_helpPanelOpen : !!force;
  if (opening) {
    if (typeof _closeSidePanels === 'function') _closeSidePanels(true);
    document.body.classList.add('has-left-panel');     // push main content right
    if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('helpNavBtn');
  } else {
    document.body.classList.remove('has-left-panel');  // restore main content width
    if (typeof _getActiveViewBtn === 'function') _setActiveSidebarBtn(_getActiveViewBtn());
    else if (typeof _setActiveSidebarBtn === 'function') _setActiveSidebarBtn('chatNavBtn');
  }
  _helpPanelOpen = opening;
  panel.classList.toggle('help-panel-open', _helpPanelOpen);
}
