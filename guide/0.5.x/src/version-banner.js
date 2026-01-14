// Add version banner to top of every page
(function() {
  const content = document.querySelector('#content main');
  if (content) {
    // Calculate relative path to root based on current page depth
    const path = window.location.pathname;
    // Count directory depth (subtract 1 for the file itself)
    const depth = (path.match(/\//g) || []).length - 1;
    const rootPath = depth > 0 ? '../'.repeat(depth) : './';

    const banner = document.createElement('div');
    banner.className = 'version-banner';
    banner.innerHTML = '📘 <strong>Stable Version (0.5.x)</strong> • Looking for scripting features? Check the <a href="' + rootPath + 'preview/introduction.html">Preview Guide</a>';
    content.insertBefore(banner, content.firstChild);
  }
})();
