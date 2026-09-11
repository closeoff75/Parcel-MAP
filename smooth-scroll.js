/**
 * Darkroom Engineering Lenis Smooth Scrolling Integration
 * https://github.com/darkroomengineering/lenis
 */

import Lenis from 'lenis';
import 'lenis/dist/lenis.css';

// Initialize Lenis
const lenis = new Lenis({
  autoRaf: true,
  duration: 1.25,
  easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
  smoothWheel: true,
  overscroll: true
});

// Expose on window for global access (e.g. search scroll, navbar jumps)
window.lenis = lenis;

/**
 * Step 3A: Centralized Controlled Viewport Auto-Scroll for 3D Globe
 * Visually centers the 3D interactive globe canvas in the available browser viewport below the sticky/fixed header.
 * Ensures fixed header never covers the globe, prevents layout jumps, and prevents duplicate scroll actions.
 */
let isAutoScrolling = false;

window.scrollToParcelGlobe = function() {
  if (isAutoScrolling) return Promise.resolve();
  isAutoScrolling = true;

  return new Promise((resolve) => {
    // 1. Wait until globe container exists and its dimensions are rendered in the DOM
    const checkGlobeReady = (retryCount = 0) => {
      const globeCanvas = document.getElementById('globeCanvasContainer');
      const globeSection = document.getElementById('parcel-globe') || document.querySelector('.globe-section');
      const targetElement = globeCanvas || globeSection;

      if (!targetElement) {
        isAutoScrolling = false;
        resolve();
        return;
      }

      const rect = targetElement.getBoundingClientRect();
      if ((rect.height === 0 || rect.width === 0) && retryCount < 30) {
        requestAnimationFrame(() => checkGlobeReady(retryCount + 1));
        return;
      }

      try {
        const header = document.querySelector('header.site-header') || document.querySelector('header');
        const headerHeight = header ? header.getBoundingClientRect().height : 64;
        const viewportHeight = window.innerHeight;

        // Center of the 3D globe in absolute document coordinates
        const globeCenter = rect.top + window.scrollY + (rect.height / 2);

        // Visible viewport area strictly below the fixed/sticky navbar
        const visibleHeight = Math.max(200, viewportHeight - headerHeight);

        // Desired visual center in the visible viewport
        const visibleCenterY = headerHeight + (visibleHeight / 2);

        // Calculate scroll target so globeCenter matches visibleCenterY
        let targetScroll = globeCenter - visibleCenterY;

        // Check top clearance: ensure the top of the globe card is not obscured by navbar
        const globeCard = document.querySelector('.globe-card') || targetElement;
        const cardRect = globeCard.getBoundingClientRect();
        const cardPageTop = cardRect.top + window.scrollY;
        
        // If globe canvas or card is taller than visible viewport, ensure top clearance below header
        if (rect.height > visibleHeight) {
          targetScroll = Math.max(targetScroll, cardPageTop - headerHeight - 12);
        }

        // Clamp to document scroll boundaries (no negative scroll, no overscroll beyond page limits)
        const maxScroll = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
        targetScroll = Math.max(0, Math.min(targetScroll, maxScroll));

        const currentScroll = window.scrollY || window.pageYOffset || 0;
        const onComplete = () => {
          isAutoScrolling = false;
          resolve();
        };

        // If already centered (within 4px), resolve immediately
        if (Math.abs(currentScroll - targetScroll) < 4) {
          onComplete();
          return;
        }

        if (window.lenis && typeof window.lenis.scrollTo === 'function') {
          window.lenis.scrollTo(targetScroll, {
            duration: 1.25,
            easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
            onComplete: onComplete
          });
          // Safety timeout in case onComplete event is missed
          setTimeout(onComplete, 1350);
        } else {
          window.scrollTo({
            top: Math.round(targetScroll),
            behavior: 'smooth'
          });
          setTimeout(onComplete, 750);
        }
      } catch (err) {
        console.warn('scrollToParcelGlobe error:', err);
        isAutoScrolling = false;
        resolve();
      }
    };

    requestAnimationFrame(() => checkGlobeReady(0));
  });
};

// Seamless smooth scrolling helper for parcel globe navigation (Maintained for backward compatibility)
window.smoothScrollToGlobe = function(offset = -20) {
  if (typeof window.scrollToParcelGlobe === 'function') {
    window.scrollToParcelGlobe();
  } else {
    const target = document.getElementById('parcel-globe') || document.querySelector('.globe-section');
    if (!target) return;

    if (window.lenis) {
      window.lenis.scrollTo(target, {
        offset: offset,
        duration: 1.4,
        easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t))
      });
    } else {
      target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }
};

export default lenis;
