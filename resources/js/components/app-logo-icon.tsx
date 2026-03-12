import type { ImgHTMLAttributes } from 'react';

export default function AppLogoIcon(props: ImgHTMLAttributes<HTMLImageElement>) {
    return (
        <img
            src="/image/logo_beacon.png"
            alt="Beacon Logger Cloud"
            {...props}
        />
    );
}
