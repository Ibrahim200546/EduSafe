import type { Metadata } from 'next';
import './globals.css';
import './auth-ui.css';
export const metadata:Metadata={title:{default:'EduSafe — спокойствие начинается с заботы',template:'%s · EduSafe'},description:'Посещаемость без очереди, связь с родителями и координация помощи. Единое пространство вашей школы.',applicationName:'EduSafe',robots:{index:true,follow:true}};
export default function RootLayout({children}:{children:React.ReactNode}){return <html lang="ru"><body>{children}</body></html>;}
