document.addEventListener("DOMContentLoaded", () => {
    const breadcrumbNav = document.getElementById("breadcrumb-nav");
    const zones = Array.from(document.querySelectorAll("[data-label]"));

    let lastActiveZone = null;

    function getActiveZone() {
        const viewportMiddle = window.innerHeight / 2;

        for (let i = zones.length - 1; i >= 0; i--) {
            const rect = zones[i].getBoundingClientRect();
            if (rect.top <= viewportMiddle) {
                return zones[i];
            }
        }

        return zones[0];
    }

    function buildBreadcrumb(zone) {
        breadcrumbNav.innerHTML = "";

        const chain = [];
        let current = zone;

        while (current) {
            chain.unshift(current);
            const parentId = current.getAttribute("data-parent");
            current = parentId ? document.getElementById(parentId) : null;
        }

        chain.forEach((el, index) => {
            const link = document.createElement("a");
            link.textContent = el.getAttribute("data-label");
            link.href = `#${el.id}`;
            breadcrumbNav.appendChild(link);

            if (index < chain.length - 1) {
                breadcrumbNav.appendChild(document.createTextNode(" • "));
            }
        });
    }

    function onScroll() {
        const activeZone = getActiveZone();

        if (activeZone !== lastActiveZone) {
            lastActiveZone = activeZone;
            buildBreadcrumb(activeZone);
        }
    }

    window.addEventListener("scroll", onScroll);
    onScroll();
});