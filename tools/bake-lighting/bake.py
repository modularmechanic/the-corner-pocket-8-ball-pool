"""
Step 2 of the lightmap bake: path-trace the room's indirect light in Blender Cycles.

Reads .cache/room.glb and .cache/lights.json (written by export-room.ts), rebuilds the room's lights
as real Cycles lights, and bakes the DIFFUSE / INDIRECT pass of every object named BAKE_* into one
image. Direct light is deliberately excluded: three still computes that in real time, and adding the
two is what keeps the room responsive without double-counting.

Run head-less through bake.sh, never from the Blender UI, so the result is reproducible.
"""

import json
import math
import os
import sys

import bpy
from mathutils import Quaternion, Vector

HERE = os.path.dirname(os.path.realpath(__file__))
CACHE = os.path.join(HERE, ".cache")


def argv():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    options = {"size": 512, "samples": 256, "margin": 6}
    for arg in args:
        key, _, value = arg.partition("=")
        if key in options:
            options[key] = int(value)
    return options


def clear_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)


def import_room():
    bpy.ops.import_scene.gltf(filepath=os.path.join(CACHE, "room.glb"))
    # glTF is Y-up, Blender is Z-up; the importer rotates the root. Apply it so the light positions
    # we place from the JSON (which are in three's Y-up world) can be converted with one known rule.
    for obj in list(bpy.context.scene.objects):
        if obj.parent is None:
            obj.rotation_euler = (0.0, 0.0, 0.0)
            obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(bpy.context.scene.objects))
    bpy.ops.object.transform_apply(location=False, rotation=True, scale=False)


def to_blender(position):
    """three (Y-up, right-handed) -> Blender (Z-up, right-handed)."""
    x, y, z = position
    return Vector((x, -z, y))


def to_blender_quat(quaternion):
    x, y, z, w = quaternion
    # Same basis change applied to the rotation: (x, y, z) -> (x, -z, y).
    return Quaternion((w, x, -z, y))


def add_lights(lights):
    """three's lights, in watts, as Cycles lights. Orientation matters for rect and spot: three points
    them down -Z in their own space, and so does Blender, so the converted quaternion is used as-is."""
    for index, light in enumerate(lights):
        kind = light["type"]
        data = bpy.data.lights.new(
            name=f"{light['name']}-{index}",
            type={"point": "POINT", "spot": "SPOT", "rect": "AREA"}[kind],
        )
        data.color = tuple(light["color"])
        data.energy = light["watts"]
        if kind == "rect":
            data.shape = "RECTANGLE"
            data.size, data.size_y = light["size"]
        else:
            data.shadow_soft_size = light["radius"]
        if kind == "spot":
            data.spot_size = light["angle"] * 2.0
            data.spot_blend = light["penumbra"]
        obj = bpy.data.objects.new(data.name, data)
        obj.location = to_blender(light["position"])
        obj.rotation_mode = "QUATERNION"
        obj.rotation_quaternion = to_blender_quat(light["quaternion"])
        bpy.context.scene.collection.objects.link(obj)


def configure_cycles(options):
    scene = bpy.context.scene
    try:
        scene.render.engine = "CYCLES"
    except TypeError as error:
        raise SystemExit(f"Cycles is not available in this Blender: {error}")
    prefs = bpy.context.preferences.addons["cycles"].preferences
    prefs.get_devices()
    # Prefer the GPU. This machine is somebody's working desktop; a CPU bake would take every core.
    for backend in ("METAL", "OPTIX", "CUDA", "HIP", "ONEAPI"):
        try:
            prefs.compute_device_type = backend
        except TypeError:
            continue
        prefs.get_devices()
        if any(device.type == backend for device in prefs.devices):
            for device in prefs.devices:
                device.use = device.type == backend
            scene.cycles.device = "GPU"
            break
    else:
        scene.cycles.device = "CPU"
        scene.render.threads_mode = "FIXED"
        scene.render.threads = max(1, (os.cpu_count() or 4) // 2)

    scene.cycles.samples = options["samples"]
    scene.cycles.use_denoising = True
    scene.cycles.max_bounces = 8
    scene.cycles.diffuse_bounces = 6
    scene.cycles.caustics_reflective = False
    scene.cycles.caustics_refractive = False
    # No sky: this is a windowless interior and an environment light would wash the bake flat.
    world = bpy.data.worlds.new("black")
    world.use_nodes = True
    background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs["Color"].default_value = (0.0, 0.0, 0.0, 1.0)
    scene.world = world

    scene.render.bake.use_pass_direct = False
    scene.render.bake.use_pass_indirect = True
    # No colour pass: the lightmap must hold arriving light only. three multiplies it by the
    # surface's own albedo in the shader, so baking albedo in would square it.
    scene.render.bake.use_pass_color = False
    scene.render.bake.margin = options["margin"]
    scene.render.bake.use_selected_to_active = False
    scene.render.bake.use_clear = True


def bake_targets(options):
    targets = [obj for obj in bpy.context.scene.objects if obj.name.startswith("BAKE_")]
    if not targets:
        raise SystemExit("no BAKE_* objects in room.glb — export-room.ts matched no lightmap target")

    image = bpy.data.images.new(
        "pub-indirect", width=options["size"], height=options["size"], float_buffer=False
    )
    for obj in targets:
        material = obj.data.materials[0] if obj.data.materials else None
        if material is None:
            material = bpy.data.materials.new(f"{obj.name}-mat")
            obj.data.materials.append(material)
        material.use_nodes = True
        node = material.node_tree.nodes.new("ShaderNodeTexImage")
        node.image = image
        node.select = True
        material.node_tree.nodes.active = node
        if not obj.data.uv_layers:
            raise SystemExit(f"{obj.name} arrived without UVs; the exporter must ship UV0")

    bpy.ops.object.select_all(action="DESELECT")
    for obj in targets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    bpy.ops.object.bake(type="DIFFUSE")

    out = os.path.join(CACHE, "pub-indirect.png")
    image.filepath_raw = out
    image.file_format = "PNG"
    image.save()
    print(f"baked {len(targets)} target(s) -> {out}")


def main():
    options = argv()
    with open(os.path.join(CACHE, "lights.json")) as handle:
        manifest = json.load(handle)
    clear_scene()
    import_room()
    add_lights(manifest["lights"])
    configure_cycles(options)
    bake_targets(options)


main()
