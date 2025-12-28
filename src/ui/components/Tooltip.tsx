import React, { useState } from "react";

interface TooltipProps {
    content: string;
    children: React.ReactNode;
    align?: "left" | "center" | "right";
}

export const Tooltip: React.FC<TooltipProps> = ({ content, children, align = "center" }) => {
    const [isVisible, setIsVisible] = useState(false);

    const positionClasses = {
        left: "left-0",
        center: "left-1/2 -translate-x-1/2",
        right: "right-0",
    };

    const arrowClasses = {
        left: "left-4",
        center: "left-1/2 -translate-x-1/2",
        right: "right-4",
    };

    return (
        <div
            className="relative flex items-center"
            onMouseEnter={() => setIsVisible(true)}
            onMouseLeave={() => setIsVisible(false)}
        >
            {children}
            {isVisible && (
                <div className={`absolute bottom-full mb-2 px-2.5 py-1.5 bg-slate-800 text-white text-[11px] font-medium rounded-lg shadow-xl w-max max-w-[200px] text-center z-50 animate-in fade-in zoom-in-95 duration-100 leading-normal pointer-events-none ${positionClasses[align]}`}>
                    {content}
                    {/* Arrow */}
                    <div className={`absolute top-full -mt-1 border-4 border-transparent border-t-slate-800 ${arrowClasses[align]}`}></div>
                </div>
            )}
        </div>
    );
};
