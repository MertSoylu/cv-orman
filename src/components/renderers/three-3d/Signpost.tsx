"use client";

import { useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { Billboard, Text } from "@react-three/drei";
import { type ThreeEvent, useFrame } from "@react-three/fiber";
import { healthyToWilted } from "./utils";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

const POST_COLOR = "#5c4632";
const FRAME_COLOR = "#a07a4e";
const PLAQUE_COLOR = "#3d2c1e";
const TEXT_COLOR = "#f3e6c8";
const ACCENT_COLOR = "#e0764f";
const HEALTH_BASE = new THREE.Color("#4f7942");

const HOVER_DAMP_LAMBDA = 3.5;
const HOVER_SCALE_EXTRA = 0.07;

export interface SignpostProps {
  position: [number, number, number];
  label: string;
  /** 0-1; drives the plaque's health dot toward the shared dry palette. */
  healthStage: number;
  onClick: () => void;
}

/** Museum-placard signpost: a wooden post + a camera-facing framed plaque naming the repo, with a small dot echoing the tree's health color. */
export default function Signpost({ position, label, healthStage, onClick }: SignpostProps) {
  const [pointerHovered, setPointerHovered] = useState(false);
  const plaqueGroupRef = useRef<THREE.Group>(null);
  const accentMaterialRef = useRef<THREE.MeshStandardMaterial>(null);
  const hoverT = useRef(0);
  const reducedMotion = usePrefersReducedMotion();

  const healthColor = useMemo(() => healthyToWilted(HEALTH_BASE, healthStage), [healthStage]);

  useFrame((_, delta) => {
    const target = pointerHovered ? 1 : 0;
    hoverT.current = reducedMotion ? target : THREE.MathUtils.damp(hoverT.current, target, HOVER_DAMP_LAMBDA, delta);

    if (plaqueGroupRef.current) {
      plaqueGroupRef.current.scale.setScalar(1 + hoverT.current * HOVER_SCALE_EXTRA);
    }
    if (accentMaterialRef.current) {
      accentMaterialRef.current.emissiveIntensity = 0.25 + hoverT.current * 0.35;
    }
  });

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    onClick();
  };

  const handlePointerOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setPointerHovered(true);
    document.body.style.cursor = "pointer";
  };

  const handlePointerOut = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    setPointerHovered(false);
    document.body.style.cursor = "auto";
  };

  return (
    <group
      position={position}
      onClick={handleClick}
      onPointerOver={handlePointerOver}
      onPointerOut={handlePointerOut}
    >
      <mesh position={[0, 0.9, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[0.055, 0.08, 1.8, 8]} />
        <meshStandardMaterial color={POST_COLOR} roughness={0.9} />
      </mesh>
      <mesh position={[0, 1.82, 0]} castShadow>
        <sphereGeometry args={[0.06, 8, 6]} />
        <meshStandardMaterial color={POST_COLOR} roughness={0.9} />
      </mesh>

      <Billboard position={[0, 1.98, 0]}>
        <group ref={plaqueGroupRef} scale={1}>
            <mesh>
              <planeGeometry args={[2.34, 0.82]} />
              <meshStandardMaterial color={FRAME_COLOR} roughness={0.85} />
            </mesh>
            <mesh position={[0, 0, 0.004]}>
              <planeGeometry args={[2.22, 0.7]} />
              <meshStandardMaterial color={PLAQUE_COLOR} roughness={0.8} />
            </mesh>

            <mesh position={[-0.98, 0.22, 0.008]}>
              <circleGeometry args={[0.045, 12]} />
              <meshStandardMaterial color={healthColor} emissive={healthColor} emissiveIntensity={0.35} roughness={0.5} />
            </mesh>

            <Text
              position={[0, 0.04, 0.008]}
              fontSize={0.24}
              maxWidth={2}
              textAlign="center"
              anchorX="center"
              anchorY="middle"
              letterSpacing={0.02}
              color={TEXT_COLOR}
            >
              {label}
            </Text>

            <mesh position={[0, -0.21, 0.008]}>
              <planeGeometry args={[0.56, 0.022]} />
              <meshStandardMaterial
                ref={accentMaterialRef}
                color={ACCENT_COLOR}
                emissive={ACCENT_COLOR}
                emissiveIntensity={0.25}
                roughness={0.6}
              />
            </mesh>
        </group>
      </Billboard>
    </group>
  );
}