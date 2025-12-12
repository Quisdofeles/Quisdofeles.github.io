document.addEventListener("DOMContentLoaded", () => {
    const breadcrumbNav = document.getElementById("breadcrumb-nav");
    const zones = document.querySelectorAll("[data-label]");

    if (!breadcrumbNav || zones.length === 0) return;

    function getBreadcrumbChain(zone) {
        const chain = [];
        let current = zone;
        while (current) {
            const label = current.getAttribute("data-label");
            if (label) chain.unshift({ label, element: current });
            const parentId = current.getAttribute("data-parent");
            current = parentId ? document.getElementById(parentId) : null;
        }
        return chain;
    }

    function updateBreadcrumb() {
        const viewportCenter = window.scrollY + window.innerHeight / 2;
        let closestZone = zones[0];
        let minDistance = Infinity;

        zones.forEach(zone => {
            const zoneRect = zone.getBoundingClientRect();
            const zoneMiddle = window.scrollY + zoneRect.top + zoneRect.height / 2;
            const distance = Math.abs(viewportCenter - zoneMiddle);

            if (distance < minDistance) {
                minDistance = distance;
                closestZone = zone;
            }
        });

        const chain = getBreadcrumbChain(closestZone);
        breadcrumbNav.innerHTML = "";

        chain.forEach((item, index) => {
            const a = document.createElement("a");
            a.textContent = item.label;
            a.href = "#" + item.element.id;
            breadcrumbNav.appendChild(a);

            if (index < chain.length - 1) {
                breadcrumbNav.appendChild(document.createTextNode(" • "));
            }
        });
    }

    updateBreadcrumb();
    window.addEventListener("scroll", updateBreadcrumb);
    window.addEventListener("resize", updateBreadcrumb); // recalc on resize
});