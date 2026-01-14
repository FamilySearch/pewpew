// Add version banner to top of every page
(function() {
  const content = document.querySelector('#content main');
  if (content) {
    // Calculate path to preview/ directory from current location
    // Handles both /pewpew/introduction.html and /introduction.html cases
    const path = window.location.pathname;

    // Extract the portion after any base path (like /pewpew/)
    // The guide files live at the root or in subdirectories like /config/
    let pathAfterBase;

    if (path.includes('/pewpew/')) {
      // Remove everything up to and including /pewpew/
      pathAfterBase = path.substring(path.indexOf('/pewpew/') + '/pewpew/'.length);
    } else {
      // No base path, use path as-is (remove leading slash)
      pathAfterBase = path.startsWith('/') ? path.substring(1) : path;
    }

    // Count directory depth (number of slashes before the filename)
    // e.g., "config/common-types/expressions.html" has 2 directories
    const lastSlash = pathAfterBase.lastIndexOf('/');
    const dirPath = lastSlash >= 0 ? pathAfterBase.substring(0, lastSlash) : '';
    const depth = dirPath ? (dirPath.match(/\//g) || []).length + 1 : 0;

    const rootPath = depth > 0 ? '../'.repeat(depth) : '';

    const banner = document.createElement('div');
    banner.className = 'version-banner';
    banner.innerHTML = '📘 <strong>Stable Version (0.5.x)</strong> • Looking for scripting features? Check the <a href="' + rootPath + 'preview/introduction.html">Preview Guide</a>';
    content.insertBefore(banner, content.firstChild);
  }
})();
