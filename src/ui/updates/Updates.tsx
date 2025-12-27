import React, { useLayoutEffect, useRef } from 'react';
import { gsap } from 'gsap';
import { Cloud, Shield, CheckCircle } from 'lucide-react';
import logo from '../../assets/icons/128.png';

// --- CONFIGURATION: EDIT THIS FOR NEW VERSIONS ---
const UPDATE_DATA = {
    title: "What’s new in this update",
    description: "This update brings a fresh new look, improves local data reliability, and lays the groundwork for upcoming cross-device syncing.",
    features: [
        { icon: <Cloud size={24} strokeWidth={2} />, text: "Sync Prep" },
        { icon: <Shield size={24} strokeWidth={2} />, text: "Reliability" },
        { icon: <CheckCircle size={24} strokeWidth={2} />, text: "New Look" }
    ],
    reassurance: "No action required. Veracross Plus works exactly as before."
};

export default function Updates() {
    const containerRef = useRef<HTMLDivElement>(null);

    // Safety check for dev environment vs production extension
    const version = typeof chrome !== 'undefined' && chrome.runtime?.getManifest
        ? chrome.runtime.getManifest().version
        : "0.0.0 (Dev)";

    // Split for styling: "You've been updated to " + "v..."
    const prefix = "You've been updated to ";
    const versionText = `v${version}`;

    useLayoutEffect(() => {
        const ctx = gsap.context(() => {
            const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

            if (prefersReducedMotion) {
                gsap.set(".char", { opacity: 1, y: 0, filter: "blur(0px)" });
                gsap.set(".details", { opacity: 1, visibility: "visible" });
                gsap.to(".feature-item", { opacity: 1 });
                gsap.to(".reassurance", { opacity: 1 });
                gsap.to(".details h2", { opacity: 1 });
                gsap.to(".details p", { opacity: 1 });
                return;
            }

            const tl = gsap.timeline({ defaults: { ease: "power2.out" } });

            // Initial state
            gsap.set(".details", { visibility: "visible" });

            // --- ACT 1: The Moment ---

            // 1. Reveal Text (Slightly slower stagger for more impact)
            tl.to(".char", {
                opacity: 1,
                y: 0,
                filter: "blur(0px)",
                duration: 1.0,
                stagger: 0.05,
                ease: "power2.out"
            });

            // 1.5. Logo Reveal
            tl.fromTo(".brand-logo-container",
                { opacity: 0, scale: 0.8, y: 10 },
                { opacity: 1, scale: 1, y: 0, duration: 0.8, ease: "back.out(1.7)" },
                "-=0.5"
            );

            // 2. The Pause
            tl.to({}, { duration: 1.2 });

            // --- ACT 2: The Context ---

            // 3. Hero recedes
            tl.to("#version-text", {
                y: -60,
                scale: 0.9,
                opacity: 0.3,
                filter: "blur(4px)",
                duration: 1.2,
                ease: "power2.inOut"
            });

            // 4. Glass Card & Content Reveal
            // Pop the glass card slightly
            tl.fromTo(".details",
                { y: 40, opacity: 0, scale: 0.95 },
                { y: 0, opacity: 1, scale: 1, duration: 1.0, ease: "power3.out" },
                "-=1.0"
            );

            // Staggered internals
            tl.fromTo([".details h2", ".details p.description"],
                { y: 20, opacity: 0 },
                { y: 0, opacity: 1, duration: 0.8, stagger: 0.2 },
                "-=0.6"
            );

            // Feature Grid (Icons pop in)
            tl.fromTo(".feature-item",
                { y: 20, opacity: 0, scale: 0.9 },
                { y: 0, opacity: 1, scale: 1, duration: 0.6, stagger: 0.15, ease: "back.out(1.7)" },
                "-=0.4"
            );

            // Reassurance
            tl.fromTo(".reassurance",
                { opacity: 0 },
                { opacity: 1, duration: 1.0 },
                "+=0.1"
            );

        }, containerRef);

        return () => ctx.revert();
    }, []);

    // Helper to render split text
    const renderChars = (str: string, isHighlight = false) => {
        return str.split("").map((char, index) => (
            <span
                key={index}
                className={`char ${isHighlight ? 'brand-char' : ''} ${char === " " ? "space" : ""}`}
            >
                {char === " " ? "\u00A0" : char}
            </span>
        ));
    };

    return (
        <main className="update-wrapper" ref={containerRef}>
            <div className="ambient-glow" />

            <div className="brand-logo-container">
                <img src={logo} alt="Veracross Plus Logo" className="brand-logo" />
            </div>

            <div className="hero">
                <h1 id="version-text">
                    {renderChars(prefix)}
                    <span className="hero-highlight">
                        {renderChars(versionText, true)}
                    </span>
                </h1>
            </div>

            <section className="details">
                <h2>{UPDATE_DATA.title}</h2>
                <p className="description">
                    {UPDATE_DATA.description}
                </p>

                <div className="feature-grid">
                    {UPDATE_DATA.features.map((feature, i) => (
                        <div className="feature-item" key={i}>
                            <div className="icon-box">
                                {feature.icon}
                            </div>
                            <span className="feature-text">{feature.text}</span>
                        </div>
                    ))}
                </div>

                <p className="reassurance">
                    {UPDATE_DATA.reassurance}
                </p>
            </section>
        </main>
    );
}
