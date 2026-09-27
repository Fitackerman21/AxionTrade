"use client";

/**
 * Hero scene for the landing page — AxionTrade-flavoured port of the
 * AlgoSensei reference: a slow-orbiting dot-grid floor, a wireframe sphere,
 * rising particles and a floating brand accent. Everything is unlit
 * (meshBasicMaterial) so no environment HDR is needed, and the palette comes
 * from the app theme tokens (brand blue / gain green on the dark background).
 */

import { useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Float } from "@react-three/drei";
import type { Group, Points } from "three";

const BLUE = "#2e90fa";
const GREEN = "#00c896";

/** Deterministic PRNG so the scene is identical on every load (no hydration flicker). */
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Ring of glowing dots orbiting slowly below the wordmark — nods to the reference grid. */
function DotRing() {
  const group = useRef<Group>(null);

  const positions = useMemo(() => {
    const rand = mulberry32(20260926);
    const pts: Array<[number, number, number]> = [];
    for (let ring = 0; ring < 3; ring++) {
      const radius = 7 + ring * 2.6;
      const count = 34 + ring * 10;
      for (let i = 0; i < count; i++) {
        const angle = (i / count) * Math.PI * 2 + rand() * 0.08;
        const y = -3.4 - ring * 1.1 + rand() * 0.5;
        pts.push([Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
      }
    }
    return pts;
  }, []);

  useFrame(({ clock }) => {
    if (group.current) group.current.rotation.y = clock.getElapsedTime() * 0.05;
  });

  return (
    <group ref={group}>
      {positions.map((p, i) => (
        <mesh key={i} position={p}>
          <sphereGeometry args={[0.055, 12, 12]} />
          <meshBasicMaterial color={i % 4 === 0 ? GREEN : BLUE} transparent opacity={0.75} />
        </mesh>
      ))}
    </group>
  );
}

/** Distorted wireframe sphere behind the copy — the reference's data globe. */
function WireGlobe() {
  const mesh = useRef<Group>(null);

  useFrame(({ clock }) => {
    if (mesh.current) {
      mesh.current.rotation.y = clock.getElapsedTime() * 0.1;
      mesh.current.rotation.x = Math.sin(clock.getElapsedTime() * 0.2) * 0.12;
    }
  });

  return (
    <group ref={mesh} position={[0, 0.4, -2]}>
      <mesh>
        <sphereGeometry args={[8, 32, 32]} />
        <meshBasicMaterial color={BLUE} wireframe transparent opacity={0.1} />
      </mesh>
      <mesh>
        <sphereGeometry args={[5.6, 24, 24]} />
        <meshBasicMaterial color={GREEN} wireframe transparent opacity={0.07} />
      </mesh>
    </group>
  );
}

type Particle = { x: number; z: number; speed: number; size: number; green: boolean };

/** Thin rising particles — the reference's data dust. */
function RisingParticles() {
  const points = useRef<Points>(null);

  const { positions, meta } = useMemo(() => {
    const rand = mulberry32(1337);
    const count = 220;
    const pos = new Float32Array(count * 3);
    const m: Particle[] = [];
    for (let i = 0; i < count; i++) {
      const angle = rand() * Math.PI * 2;
      const radius = 3 + rand() * 11;
      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;
      pos[i * 3] = x;
      pos[i * 3 + 1] = (rand() - 0.5) * 12;
      pos[i * 3 + 2] = z;
      m.push({
        x,
        z,
        speed: 0.25 + rand() * 0.45,
        size: 0.04 + rand() * 0.07,
        green: rand() > 0.7,
      });
    }
    return { positions: pos, meta: m };
  }, []);

  useFrame(({ clock }) => {
    const pts = points.current;
    if (!pts) return;
    const t = clock.getElapsedTime();
    const arr = pts.geometry.attributes.position.array as Float32Array;
    for (let i = 0; i < meta.length; i++) {
      let y = arr[i * 3 + 1] + meta[i].speed * 0.016;
      if (y > 6) y = -6;
      arr[i * 3 + 1] = y;
      // gentle drift so columns don't look static
      arr[i * 3] = meta[i].x + Math.sin(t * 0.4 + i) * 0.18;
    }
    pts.geometry.attributes.position.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.07} color={BLUE} transparent opacity={0.55} sizeAttenuation />
    </points>
  );
}

/** Floating brand accent — the dot from the AxionTrade mark, gently bobbing. */
function BrandAccent() {
  return (
    <Float speed={2} rotationIntensity={0.4} floatIntensity={1.2}>
      <mesh position={[4.6, 2.2, 1]}>
        <icosahedronGeometry args={[0.45, 0]} />
        <meshBasicMaterial color={GREEN} wireframe transparent opacity={0.85} />
      </mesh>
      <mesh position={[-4.9, 1.6, 0.5]}>
        <octahedronGeometry args={[0.32, 0]} />
        <meshBasicMaterial color={BLUE} wireframe transparent opacity={0.8} />
      </mesh>
    </Float>
  );
}

export function LandingScene() {
  return (
    <Canvas
      camera={{ position: [0, 0.6, 15], fov: 58 }}
      dpr={[1, 1.75]}
      gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}
      style={{ position: "absolute", inset: 0 }}
    >
      <fog attach="fog" args={["#0b0e11", 12, 34]} />
      <WireGlobe />
      <DotRing />
      <RisingParticles />
      <BrandAccent />
    </Canvas>
  );
}
