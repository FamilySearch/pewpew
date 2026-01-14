// Add version banner to top of every page
(function() {
  const content = document.querySelector('#content main');
  if (content) {
    // Get the pathname and extract just the part after any base path
    // This handles cases like /pewpew/preview/foo.html or just /preview/foo.html
    const path = window.location.pathname;

    // Find where 'preview' appears in the path
    const previewIndex = path.indexOf('/preview/');
    if (previewIndex === -1) {
      return; // Not in preview directory, shouldn't happen
    }

    // Get the path after 'preview/' (e.g., 'viewing-results.html' or 'config/foo.html')
    const pathAfterPreview = path.substring(previewIndex + '/preview/'.length);

    // Count slashes in the path after preview to determine depth
    const depth = (pathAfterPreview.match(/\//g) || []).length;

    // Go up the appropriate number of levels, then one more to exit preview/
    const rootPath = '../'.repeat(depth + 1);

    const banner = document.createElement('div');
    banner.className = 'version-banner version-banner-preview';
    banner.innerHTML = '⚠️ <strong>Preview Version (0.6.x with Scripting)</strong> • For stable version, see the <a href="' + rootPath + 'introduction.html">Main Guide</a>';
    content.insertBefore(banner, content.firstChild);
  }
})();
