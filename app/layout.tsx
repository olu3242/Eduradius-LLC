import type { Metadata } from 'next';
import './globals.css';
export const metadata: Metadata = { title: 'EduRadius LLC | AI with purpose', metadataBase: new URL('https://eduradius-six.vercel.app'), openGraph: { images: [{url:'/brand/radius-v2/social-card.png',width:1200,height:675,alt:'EduRadius LLC - Radius identity'}] }, icons: { icon: '/brand/radius-v2/eduradius-symbol.svg', apple: '/brand/radius-v2/apple-touch-icon.png' }, description: 'AI consulting, governance, adoption, training and education. A practical path from ambition to impact.' };
export default function Layout({children}:{children:React.ReactNode}) {return <html lang="en"><body>{children}</body></html>}
