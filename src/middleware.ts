import { type NextRequest } from 'next/server'
import { updateSession } from './lib/supabase/middleware'

export async function middleware(request: NextRequest) {
    return await updateSession(request)
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * - api/upload-video: el middleware copia el cuerpo de la petición con un límite de 10 MB,
         *   lo que corta los videos subidos. Esa ruta valida la sesión por su cuenta.
         */
        '/((?!_next/static|_next/image|favicon.ico|api/upload-video|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
}
