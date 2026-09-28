# Deepdelve — Smash Arena

An isometric pixel-art arena brawler in the spirit of *Smash TV*. You are a prisoner thrown into
the pit: survive the waves, win the crowd, spend their coin at the market, and go one room deeper.

**Play it in the browser:** https://tniemeijer.github.io/smash_arena/

## How to play

| Key | |
|---|---|
| **WASD** | move (fixed to the screen; switchable on the pause screen) |
| **Mouse** | aim · **click** to attack |
| **Space** | dash |
| **1–4** | special moves |
| **E** | trade at a stall / take an open gate |
| **J** | your moves |
| **P** / **Esc** | pause |

Four callings, each with its own rhythm:

- **Knight** — slash and thrust in turn; the dash barges through enemies; *Riposte* turns a blow back on whoever threw it.
- **Archer** — stand still and every third arrow is a *Sure Shot* that pierces everything; so is the first after a dash.
- **Druid** — seeds leave brambles that hold enemies back; mends while standing in water; *Wellspring* raises a pool on demand.
- **Bard** — a bar of four: three strums and a *Chord* all the way round; *Discord* turns enemies on each other.

Every arena is a place — the Sands, the Cistern, the Pitch, the Icehouse, the Quarry — with its own
floor (water, oil that burns, ice, snow, boulders) and its own creature.

## Running it locally

```sh
npm install
npm run dev      # http://localhost:3100
npm test         # the whole game simulated headless in Node
npm run build
```

Built with [three.js](https://threejs.org/) and [Vite](https://vitejs.dev/). Pushing to `main`
runs the tests, builds, and publishes to GitHub Pages.
