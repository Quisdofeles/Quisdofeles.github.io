document.addEventListener('DOMContentLoaded', () => 
{
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

        setTimeout(() => {
            intro.remove();
        }, 1000);
    });
});