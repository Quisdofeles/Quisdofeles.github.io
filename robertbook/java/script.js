document.addEventListener('DOMContentLoaded', () => 
{
    // ---Logo Into Animation---
    const intro = document.getElementById('intro-animation');
    const logoAnim = document.getElementById('logo-animation');
    logoAnim.playbackRate = 1.5;
    const headerLogo = document.querySelector('.navbar-logo img');

    logoAnim.addEventListener('ended', () => 
    {
        document.body.appendChild(logoAnim);

        const headerRect = headerLogo.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        intro.style.transition = 'height 1s ease-in-out';
        intro.style.height = `${headerRect.bottom + scrollY}px`;

        logoAnim.style.top = `${headerRect.top + scrollY}px`;
        logoAnim.style.left = `${headerRect.left + scrollX}px`;
        logoAnim.style.width = `${headerRect.width}px`;
        logoAnim.style.height = `${headerRect.height}px`;
        logoAnim.style.transform = 'none';

        setTimeout(() => 
        {
            intro.remove();
        }, 1000);
    });

    const lofi = document.querySelector(".layer-lofi");
    const mifi = document.querySelector(".layer-mifi");
    const hifi = document.querySelector(".layer-hifi");
    const hero = document.querySelector(".hero-slider");

    const handle1 = document.getElementById("handle1");
    const handle2 = document.getElementById("handle2");

    let dragging = null;

    // Initial positions (percent)
    let pos1 = 4.5;
    let pos2 = 9;

    function updateLayers() {
        // Prevent overlap
        if (pos1 > pos2) pos1 = pos2;
        if (pos2 < pos1) pos2 = pos1;

        // Clip layers horizontally
        lofi.style.clipPath = `inset(0 ${100 - pos1}% 0 0)`;
        mifi.style.clipPath = `inset(0 ${100 - pos2}% 0 ${pos1}%)`;
        hifi.style.clipPath = `inset(0 0 0 ${pos2}%)`;

        // Position handles horizontally
        handle1.style.left = `${pos1}%`;
        handle2.style.left = `${pos2}%`;
    }

    function startDrag(e) {
        dragging = e.target;
    }

    function stopDrag() {
        dragging = null;
    }

    function drag(e) {
        if (!dragging) return;
        const rect = hero.getBoundingClientRect();
        const percent = ((e.clientX - rect.left) / rect.width) * 100;

        if (dragging === handle1) pos1 = Math.max(0, Math.min(percent, pos2));
        if (dragging === handle2) pos2 = Math.min(100, Math.max(percent, pos1));

        updateLayers();
    }

    // Mouse events
    handle1.addEventListener('mousedown', startDrag);
    handle2.addEventListener('mousedown', startDrag);
    document.addEventListener('mouseup', stopDrag);
    document.addEventListener('mousemove', drag);

    // Touch events for mobile
    handle1.addEventListener('touchstart', startDrag);
    handle2.addEventListener('touchstart', startDrag);
    document.addEventListener('touchend', stopDrag);
    document.addEventListener('touchmove', (e) => {
        drag(e.touches[0]);
    });

    // Initial render
    updateLayers();

    // --- NEW: Set hero height and handles vertical positions relative to hero ---
    const images = hero.querySelectorAll("img");
    let maxHeight = 0;
    let loaded = 0;

    function positionHandles() {
        const heroHeight = hero.offsetHeight;
        handle1.style.top = `${heroHeight * 0.6 - handle1.offsetHeight / 2}px`; // 60%
        handle2.style.top = `${heroHeight * 0.7 - handle2.offsetHeight / 2}px`; // 70%
    }

    images.forEach(img => {
        img.onload = () => {
            maxHeight = Math.max(maxHeight, img.offsetHeight);
            loaded++;
            if (loaded === images.length) {
                hero.style.height = maxHeight + "px";
                positionHandles(); // position handles after hero height is known
            }
        };
        if (img.complete) img.onload();
    });

    // Adjust handles and hero height on window resize
    window.addEventListener('resize', () => {
        maxHeight = 0;
        images.forEach(img => {
            maxHeight = Math.max(maxHeight, img.offsetHeight);
        });
        hero.style.height = maxHeight + "px";
        positionHandles();
        updateLayers();
    });

    // Prevent default dragging behavior
    handle1.ondragstart = () => false;
    handle2.ondragstart = () => false;
});