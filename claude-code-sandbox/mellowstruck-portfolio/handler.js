var BASE_DURATION = 25;
var DEFAULT_SPEED = 1;
var SPEED_MULTIPLIER = 3;
var MAX_SPEED = 8;
var VELOCITY_DIVISOR = 1000;
var SCROLL_RESPONSE_RATE = 0.12;
var EASE_BACK_RATE = 0.04;
var SCROLL_IDLE_THRESHOLD = 150;
var SET_COUNT = 4;

document.addEventListener("DOMContentLoaded", function() {

    gsap.registerPlugin(ScrollTrigger);

    var track = document.querySelector(".logo-bar-track");
    if (!track) return;

    var setWidth = track.scrollWidth / SET_COUNT;
    var scrollOffset = 0;
    var lastFrameTime = 0;

    var observer = new ResizeObserver(function() {
        setWidth = track.scrollWidth / SET_COUNT;
        scrollOffset = ((scrollOffset % setWidth) + setWidth) % setWidth;
    });
    observer.observe(track);

    var scrollVelocity = 0;
    var lastScrollTime = 0;

    ScrollTrigger.create({
        onUpdate: function(self) {
            scrollVelocity = self.getVelocity();
            lastScrollTime = Date.now();
        }
    });

    var currentSpeed = DEFAULT_SPEED;

    lastFrameTime = performance.now();

    function tick(now) {
        var deltaTime = now - lastFrameTime;
        deltaTime = Math.min(deltaTime, 50);
        lastFrameTime = now;

        var timeSinceScroll = Date.now() - lastScrollTime;
        var isScrolling = timeSinceScroll < SCROLL_IDLE_THRESHOLD;

        var targetSpeed;

        if (isScrolling) {
            var normalizedVelocity = scrollVelocity / VELOCITY_DIVISOR;

            if (scrollVelocity > 0) {
                targetSpeed = DEFAULT_SPEED + Math.abs(normalizedVelocity) * SPEED_MULTIPLIER;
            } else {
                targetSpeed = -(DEFAULT_SPEED + Math.abs(normalizedVelocity) * SPEED_MULTIPLIER);
            }

            targetSpeed = Math.max(-MAX_SPEED, Math.min(MAX_SPEED, targetSpeed));
        } else {
            targetSpeed = DEFAULT_SPEED;
        }

        var lerpRate = isScrolling ? SCROLL_RESPONSE_RATE : EASE_BACK_RATE;
        currentSpeed += (targetSpeed - currentSpeed) * lerpRate;

        var dt = deltaTime / 1000;
        var pixelsPerSecond = setWidth / BASE_DURATION;

        scrollOffset += pixelsPerSecond * currentSpeed * dt;
        scrollOffset = ((scrollOffset % setWidth) + setWidth) % setWidth;

        gsap.set(track, { x: -scrollOffset });

        requestAnimationFrame(tick);
    }

    requestAnimationFrame(tick);
});
