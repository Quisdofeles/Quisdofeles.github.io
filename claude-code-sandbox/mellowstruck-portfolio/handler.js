/* --------------------
HAMBURGER MENU TOGGLE
---------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var hamburger = document.querySelector(".hamburger");
    var mobileMenu = document.querySelector(".mobile-menu");
    if (!hamburger || !mobileMenu) return;

    var menuLinks = mobileMenu.querySelectorAll("a");

    function toggleMenu() {
        var isOpen = hamburger.classList.toggle("active");
        mobileMenu.classList.toggle("open");
        document.body.style.overflow = isOpen ? "hidden" : "";
    }

    function closeMenu() {
        hamburger.classList.remove("active");
        mobileMenu.classList.remove("open");
        document.body.style.overflow = "";
    }

    hamburger.addEventListener("click", toggleMenu);

    for (var i = 0; i < menuLinks.length; i++) {
        menuLinks[i].addEventListener("click", closeMenu);
    }
});

/* ------------------------------
HERO TEXT ENTRANCE & SCROLL EXIT
-------------------------------*/
document.addEventListener("DOMContentLoaded", function() {

    gsap.registerPlugin(ScrollTrigger);
    ScrollTrigger.config({ ignoreMobileResize: true });

    var heroText = document.querySelector("#hero-text");
    var allLines = [
        document.querySelector(".hero-line-1"),
        document.querySelector(".hero-line-2"),
        document.querySelector(".hero-line-3"),
        document.querySelector(".hero-line-4")
    ];

    var entranceTl = null;
    var exitScrollTrigger = null;
    var visibleCount = 0;

    function getVisibleLines() {
        return allLines.filter(function(el) {
            return el && getComputedStyle(el).display !== "none";
        });
    }

    function initAnimation() {
        var lines = getVisibleLines();
        visibleCount = lines.length;

        gsap.set(allLines, { clearProps: "all" });
        gsap.set(lines, { x: -100, opacity: 0 });

        entranceTl = gsap.timeline({
            onComplete: function() {
                var exitTl = gsap.timeline({
                    scrollTrigger: {
                        trigger: "#hero",
                        start: "center center",
                        end: "bottom top",
                        scrub: 0.25,
                        invalidateOnRefresh: true,
                        onRefresh: function(self) {
                            exitScrollTrigger = self;
                        }
                    }
                });
                exitScrollTrigger = exitTl.scrollTrigger;
                for (var i = 0; i < lines.length; i++) {
                    exitTl.to(lines[i], { x: -90, opacity: 0 }, i * 0.05);
                }
            }
        });
        lines.forEach(function(line, i) {
            entranceTl.to(line, { x: 0, opacity: 1, duration: 0.6, ease: "power3.out" }, i === 0 ? 0 : "-=0.4");
        });
    }

    initAnimation();

    new ResizeObserver(function() {
        var newCount = getVisibleLines().length;
        if (newCount === visibleCount) return;

        if (entranceTl) {
            entranceTl.kill();
            entranceTl = null;
        }
        if (exitScrollTrigger) {
            exitScrollTrigger.kill();
            exitScrollTrigger = null;
        }

        initAnimation();
    }).observe(heroText);
});

/* ----------------------------
LOGO BAR INFINITE LOOP MARQUEE
------------------------------*/
var BASE_DURATION = 25;
var DEFAULT_SPEED = 1;
var SPEED_MULTIPLIER = 3;
var MAX_SPEED = 8;
var VELOCITY_DIVISOR = 1000;
var SCROLL_RESPONSE_RATE = 0.12;
var EASE_BACK_RATE = 0.04;
var SCROLL_IDLE_THRESHOLD = 150;
var SET_COUNT = 3;

document.addEventListener("DOMContentLoaded", function() {

    window.addEventListener("orientationchange", function() {
        setTimeout(function() { ScrollTrigger.refresh(); }, 200);
    });

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

/* -------------------------------
ABOUT CARD SCROLL ENTRANCE & EXIT
--------------------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var aboutCard = document.querySelector(".about-card");
    if (!aboutCard) return;

    var elements = aboutCard.querySelectorAll("h2, p, a");
    gsap.set(elements, { x: -50, opacity: 0 });

    var entranceTl = gsap.timeline({
        scrollTrigger: {
            trigger: "#about",
            start: "top 85%",
            toggleActions: "play none none reverse",
            fastScrollEnd: true
        }
    });
    for (var i = 0; i < elements.length; i++) {
        entranceTl.to(elements[i], { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, i === 0 ? 0 : "-=0.2");
    }

    var exitTl = gsap.timeline({
        scrollTrigger: {
            trigger: "#about",
            start: "center center",
            end: "bottom top",
            scrub: 0.25
        }
    });
    for (var i = 0; i < elements.length; i++) {
        exitTl.to(elements[i], { x: -50, opacity: 0 }, i * 0.05);
    }
});

/* --------------------------
ABOUT PAGE CARD ENTRANCE
---------------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var aboutCard = document.querySelector(".about-mellowstruck-card");
    if (!aboutCard) return;

    var elements = aboutCard.querySelectorAll("h2, p, a");
    gsap.set(elements, { x: -50, opacity: 0 });

    var entranceTl = gsap.timeline();
    for (var i = 0; i < elements.length; i++) {
        entranceTl.to(elements[i], { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, i === 0 ? 0 : "-=0.2");
    }
});

/* -------------------------------
CONTACT SECTION SCROLL EXIT
--------------------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var contact = document.querySelector(".contact");
    if (!contact) return;

    var contactElements = contact.querySelectorAll("h2, p, a");
    gsap.set(contactElements, { x: -50, opacity: 0 });

    var entranceTl = gsap.timeline({
        scrollTrigger: {
            trigger: ".contact",
            start: "top 85%",
            toggleActions: "play none none reverse",
            fastScrollEnd: true
        }
    });
    for (var i = 0; i < contactElements.length; i++) {
        entranceTl.to(contactElements[i], { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, i === 0 ? 0 : "-=0.2");
    }

    var exitTl = gsap.timeline({
        scrollTrigger: {
            trigger: ".contact",
            start: "center center",
            end: "bottom top",
            scrub: 0.25
        }
    });
    for (var i = 0; i < contactElements.length; i++) {
        exitTl.to(contactElements[i], { x: -50, opacity: 0 }, i * 0.15);
    }
});

/* --------------------------
CONTACT PAGE ENTRANCE
---------------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var contactPage = document.querySelector(".contact-page");
    if (!contactPage) return;

    var elements = [
        contactPage.querySelector(".blurb"),
        contactPage.querySelector(".social-cards"),
        contactPage.querySelector("#link-card")
    ].filter(function(el) { return el; });

    gsap.set(elements, { x: -50, opacity: 0 });

    var entranceTl = gsap.timeline();
    for (var i = 0; i < elements.length; i++) {
        entranceTl.to(elements[i], { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, i === 0 ? 0 : "-=0.2");
    }
});