document.addEventListener('DOMContentLoaded', () => 
{
    const intro = document.getElementById('intro-animation');
    const logoAnim = document.getElementById('logo-animation');
    const headerLogo = document.querySelector('.wordmark img');

    logoAnim.addEventListener('ended', () => 
    {
        // Move the video to body so its position matches header coordinates
        document.body.appendChild(logoAnim);

        const headerRect = headerLogo.getBoundingClientRect();
        const videoRect = logoAnim.getBoundingClientRect();
        const scrollX = window.scrollX;
        const scrollY = window.scrollY;

        // Animate intro background height
        intro.style.transition = 'height 1s ease-in-out';
        intro.style.height = `${headerRect.bottom + scrollY}px`;

        // Animate logo: top, left, width, height, transform
        logoAnim.style.top = `${headerRect.top + scrollY}px`;
        logoAnim.style.left = `${headerRect.left + scrollX}px`;
        logoAnim.style.width = `${headerRect.width}px`;
        logoAnim.style.height = `${headerRect.height}px`;
        logoAnim.style.transform = 'none';

        // Remove intro div after animation completes
        setTimeout(() => {
            intro.remove();
        }, 1000); // matches CSS transition duration
    });
});