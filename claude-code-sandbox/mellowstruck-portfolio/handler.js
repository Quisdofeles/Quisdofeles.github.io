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

        entranceTl = gsap.timeline();
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

    var entranceTl = gsap.timeline();
    for (var i = 0; i < elements.length; i++) {
        entranceTl.to(elements[i], { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, i === 0 ? 0 : "-=0.2");
    }
});

/* ----------------------
ABOUT PAGE CARD ENTRANCE
------------------------*/
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

/* ---------------------
FEATURED WORKS ENTRANCE
-----------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var fw = document.querySelector(".featured-works");
    if (!fw) return;

    var elements = [fw.querySelector("h2")]
        .concat(Array.from(fw.querySelectorAll(".featured-works-card-left, .featured-works-card-right")))
        .concat([fw.querySelector("a")])
        .filter(function(el) { return el; });

    gsap.set(elements, { x: -50, opacity: 0 });

    var entranceTl = gsap.timeline();
    for (var i = 0; i < elements.length; i++) {
        entranceTl.to(elements[i], { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, i === 0 ? 0 : "-=0.2");
    }
});

/* ---------------------------------
FEATURED WORKS CUSTOM AUDIO PLAYERS
-----------------------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var players = Array.from(document.querySelectorAll(".player"));
    if (!players.length) return;

    var SAMPLES = 1000;
    var PLAY_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M2,2 Q2,0 4,1 L22,10.5 Q24,12 22,13.5 L4,23 Q2,24 2,22 Z"/></svg>';
    var PAUSE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="2" y="0" width="7" height="24" rx="4.5"/><rect x="15" y="0" width="7" height="24" rx="4.5"/></svg>';
    var instances = [];

    function initPlayer(playerEl, index) {
        var src = playerEl.dataset.src;
        var canvas = playerEl.querySelector(".waveform-canvas");
        var ctx2d = canvas.getContext("2d");
        var playPauseBtn = playerEl.querySelector(".play-pause-btn");
        var prevBtn = playerEl.querySelector(".prev-btn");
        var nextBtn = playerEl.querySelector(".next-btn");
        var volumeSlider = playerEl.querySelector(".volume-slider");

        var audio = new Audio();
        audio.src = src;
        audio.volume = parseFloat(volumeSlider.value);
        var amplitudeData = null;
        var rafId = null;

        function sizeCanvas() {
            var w = canvas.offsetWidth;
            if (w > 0) {
                canvas.width = w;
                canvas.height = 80;
            }
        }
        sizeCanvas();

        new ResizeObserver(function() {
            sizeCanvas();
            var progress = audio.duration ? audio.currentTime / audio.duration : 0;
            drawWaveform(progress);
        }).observe(canvas);

        fetch(src)
            .then(function(res) { return res.arrayBuffer(); })
            .then(function(buffer) {
                var audioCtx = new (window.AudioContext || window.webkitAudioContext)();
                return audioCtx.decodeAudioData(buffer);
            })
            .then(function(decoded) {
                var raw = decoded.getChannelData(0);
                var blockSize = Math.floor(raw.length / SAMPLES);
                amplitudeData = new Float32Array(SAMPLES);
                for (var i = 0; i < SAMPLES; i++) {
                    var sum = 0;
                    for (var j = 0; j < blockSize; j++) {
                        sum += Math.abs(raw[i * blockSize + j]);
                    }
                    amplitudeData[i] = sum / blockSize;
                }
                drawWaveform(0);
                playerEl.dataset.waveformReady = "true";
            })
            .catch(function() {});

        function drawWaveform(progress) {
            if (!amplitudeData) return;
            var w = canvas.width;
            var h = canvas.height;
            if (!w || !h) return;
            ctx2d.clearRect(0, 0, w, h);
            var barW = 3;
            var gap = 2;
            var pitch = barW + gap;
            var numBars = Math.floor(w / pitch);
            var playedBar = Math.floor(progress * numBars);
            for (var i = 0; i < numBars; i++) {
                var sampleIndex = Math.floor((i / numBars) * SAMPLES);
                var amp = amplitudeData[sampleIndex];
                var barH = Math.max(3, amp * h * 2);
                ctx2d.fillStyle = i < playedBar ? "#32B57C" : "rgba(255,255,255,0.3)";
                ctx2d.fillRect(i * pitch, (h - barH) / 2, barW, barH);
            }
        }

        function rafLoop() {
            if (!audio.paused) {
                var progress = audio.duration ? audio.currentTime / audio.duration : 0;
                drawWaveform(progress);
                rafId = requestAnimationFrame(rafLoop);
            }
        }

        function pauseOnly() {
            audio.pause();
            cancelAnimationFrame(rafId);
            rafId = null;
            playPauseBtn.innerHTML = PLAY_SVG;
        }

        function playFromStart() {
            audio.currentTime = 0;
            audio.play();
            playPauseBtn.innerHTML = PAUSE_SVG;
            rafId = requestAnimationFrame(rafLoop);
        }

        playPauseBtn.addEventListener("click", function() {
            if (audio.paused) {
                instances.forEach(function(inst, i) {
                    if (i !== index) inst.pauseOnly();
                });
                audio.play();
                playPauseBtn.innerHTML = PAUSE_SVG;
                rafId = requestAnimationFrame(rafLoop);
            } else {
                pauseOnly();
            }
        });

        canvas.addEventListener("click", function(e) {
            var rect = canvas.getBoundingClientRect();
            var progress = (e.clientX - rect.left) / rect.width;
            if (audio.duration) {
                audio.currentTime = progress * audio.duration;
                if (audio.paused) drawWaveform(progress);
            }
        });

        volumeSlider.addEventListener("input", function() {
            audio.volume = parseFloat(volumeSlider.value);
        });

        audio.addEventListener("ended", function() {
            cancelAnimationFrame(rafId);
            rafId = null;
            playPauseBtn.innerHTML = PLAY_SVG;
            drawWaveform(1);
        });

        prevBtn.addEventListener("click", function() {
            var prevIndex = (index - 1 + players.length) % players.length;
            instances.forEach(function(inst) { inst.pauseOnly(); });
            instances[prevIndex].playFromStart();
            var card = players[prevIndex].closest(".featured-works-card-left, .featured-works-card-right, .tracks-dmt, .tracks-tmd");
            if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
        });

        nextBtn.addEventListener("click", function() {
            var nextIndex = (index + 1) % players.length;
            instances.forEach(function(inst) { inst.pauseOnly(); });
            instances[nextIndex].playFromStart();
            var card = players[nextIndex].closest(".featured-works-card-left, .featured-works-card-right, .tracks-dmt, .tracks-tmd");
            if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
        });

        instances.push({ pauseOnly: pauseOnly, playFromStart: playFromStart });
    }

    players.forEach(function(playerEl, index) {
        initPlayer(playerEl, index);
    });
});

/* ------------------
TRACKS PAGE ENTRANCE
--------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var tp = document.querySelector(".tracks-page");
    if (!tp) return;

    var title = tp.querySelector("h2");
    var contactBtn = document.querySelector("#tracks-contact-button");
    var groups = Array.from(tp.querySelectorAll(".tracks-dmt, .tracks-tmd"));

    var allElements = [title].concat(groups).concat([contactBtn]).filter(function(el) { return el; });
    gsap.set(allElements, { x: -50, opacity: 0 });

    if (title) {
        gsap.to(title, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
    }

    groups.forEach(function(group) {
        var player = group.querySelector(".player");
        if (!player) return;

        var checkReady = setInterval(function() {
            if (player.dataset.waveformReady === "true") {
                clearInterval(checkReady);
                gsap.to(group, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
            }
        }, 100);
    });

    if (contactBtn) {
        setTimeout(function() {
            gsap.to(contactBtn, { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" });
        }, 2000);
    }
});

/* --------------------------
TRACKS PAGE SHOW MORE TOGGLE
---------------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var btns = document.querySelectorAll(".show-more-btn");
    btns.forEach(function(btn) {
        btn.addEventListener("click", function() {
            var extra = btn.previousElementSibling;
            var isOpen = extra.classList.toggle("open");
            btn.textContent = isOpen ? "Show Less..." : "Show More...";
        });
    });
});

/* -------------------------
CONTACT SECTION SCROLL EXIT
--------------------------*/
document.addEventListener("DOMContentLoaded", function() {

    var contact = document.querySelector(".contact");
    if (!contact) return;

    var contactElements = contact.querySelectorAll("h2, p, a");
    gsap.set(contactElements, { x: -50, opacity: 0 });

    var entranceTl = gsap.timeline();
    for (var i = 0; i < contactElements.length; i++) {
        entranceTl.to(contactElements[i], { x: 0, opacity: 1, duration: 0.4, ease: "power3.out" }, i === 0 ? 0 : "-=0.2");
    }
});

/* -------------------
CONTACT PAGE ENTRANCE
--------------------*/
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