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
        const videoRect = logoAnim.getBoundingClientRect();
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

    // ---Hero Slider Section---
    const slider1 = document.getElementById("slider1");
    const slider2 = document.getElementById("slider2");
    const lofi = document.querySelector(".layer-lofi");
    const mifi = document.querySelector(".layer-mifi");
    const hifi = document.querySelector(".layer-hifi");

    let lastVal1 = parseInt(slider1.value, 10);
    let lastVal2 = parseInt(slider2.value, 10);

    function updateClips() 
    {
        let val1 = parseInt(slider1.value, 10);
        let val2 = parseInt(slider2.value, 10);

        const delta1 = val1 - lastVal1;
        const delta2 = val2 - lastVal2;

        if (val1 >= val2) 
        {
            val2 += delta1;
            if (val2 > 100) val2 = 100;
            slider2.value = val2;
        }

        if (val2 <= val1) 
        {
            val1 += delta2;
            if (val1 < 0) val1 = 0;
            slider1.value = val1;
        }

        lofi.style.clipPath = `inset(0 ${100 - val1}% 0 0)`;
        mifi.style.clipPath = `inset(0 ${100 - val2}% 0 ${val1}%)`;
        hifi.style.clipPath = `inset(0 0 0 ${val2}%)`;

        lastVal1 = parseInt(slider1.value, 10);
        lastVal2 = parseInt(slider2.value, 10);
    }

    slider1.addEventListener("input", updateClips);
    slider2.addEventListener("input", updateClips);
    updateClips();
});