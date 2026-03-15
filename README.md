# PartSense WMS (Label Scanner MVP)

Production-style MVP for warehouse label inventory. 
Web-first architecture ready for a future mobile app transition. Built with React, Vite, Tailwind CSS, and Zustand.

## Core Features
1. **Camera Scanner**: Quick label scanning with confidence score and manual confirmation.
2. **Dashboard**: Real-time inventory metrics and recent operations log.
3. **Catalog & Inventory**: Browse products and their physical warehouse locations (Rack-Sector-Floor-Position).
4. **Operation History**: Audit log of all incoming and outgoing goods.

## Local Setup
1. Clone the repository
2. Install dependencies: `npm install`
3. Run the development server: `npm run dev`

## Deployment
This project is configured for one-click deployment to Netlify (`netlify.toml` included). The build command is `npm run build` and the publish directory is `dist`. SPA routing fallback is active.

## Future Mobile Transition
The current structure keeps UI components and the Zustand data store strictly separated. The mock persistence layer (`localStorage`) can easily be replaced by an API client (e.g., React Query + Axios) for syncing with a backend, maintaining the exact same UI components for a Capacitor or React Native container.
