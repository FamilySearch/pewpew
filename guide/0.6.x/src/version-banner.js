// Add version banner to top of every page
(function() {
  const content = document.querySelector('#content main');
  if (content) {
    // Calculate relative path to parent (one level up from preview/)
    const path = window.location.pathname;
    // Count directory depth (subtract 1 for the file itself, add 1 to go up from preview/)
    const depth = (path.match(/\//g) || []).length;
    const parentPath = '../'.repeat(depth);

    const banner = document.createElement('div');
    banner.className = 'version-banner version-banner-preview';
    banner.innerHTML = '⚠️ <strong>Preview Version (0.6.x with Scripting)</strong> • For stable version, see the <a href="' + parentPath + 'introduction.html">Main Guide</a>';
    content.insertBefore(banner, content.firstChild);
  }
})();
