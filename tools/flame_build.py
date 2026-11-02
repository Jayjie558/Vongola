"""Build the Vongola flame tongues and export D:\\GloveAR\\flame.glb.

Run inside the glove Blender scene (D:\\BlenderFix):
    exec(open(r'D:\\GloveAR\\tools\\flame_build.py').read())

Two sets of tongues: 8 thin vertical wisps and 5 broad, outward-curling
billows that give the flame its volume. Authored Blender +Z-up, so glTF
export turns it into +Y-up; the flame rises along +Y in Three.js and is
parented to the Palm bone (see js/flame3d.js). The painterly look lives in
the shader, not in this geometry.
"""
import bpy, bmesh, math, random
from mathutils import Vector

N, M = 16, 12


def add_tongue(bm, uv_layer, uv_of, ang, height, base_w, phase, bend,
               base_rad, thick=0.55, profile=0.58, flare=0.45):
    rings = []
    for i in range(N):
        t = i / (N - 1)
        rad = base_rad * (0.85 + flare * t ** 1.25)
        cx = math.cos(ang) * rad + math.sin(t * math.pi * 1.5 + phase) * bend * t * t
        cy = math.sin(ang) * rad + math.cos(t * math.pi * 1.25 + phase) * bend * t * t * 0.8
        center = Vector((cx, cy, height * t))

        w = base_w * (math.sin(math.pi * t) ** profile) * (1.0 - 0.2 * t) + 0.0006
        # irregular lumps along the tongue, so it does not read as a clean blade
        w *= 1.0 + 0.20 * math.sin(t * 7.0 + phase * 2.0) + 0.10 * math.sin(t * 13.0 + phase * 3.0)
        w = max(w, 0.0008)
        th = max(w * thick, 0.0009)
        rot = ang + math.pi / 2 + 0.8 * t + phase * 0.1

        ring = []
        for j in range(M):
            a = 2 * math.pi * j / M
            lx = math.cos(a) * w
            ly = math.sin(a) * th
            v = bm.verts.new(center + Vector((
                lx * math.cos(rot) - ly * math.sin(rot),
                lx * math.sin(rot) + ly * math.cos(rot),
                0.0,
            )))
            uv_of[v] = (j / M, t)
            ring.append(v)
        rings.append(ring)

    for i in range(N - 1):
        for j in range(M):
            j2 = (j + 1) % M
            bm.faces.new((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])


for ob in list(bpy.data.objects):
    if ob.name.startswith('Flame_Tongues'):
        bpy.data.objects.remove(ob, do_unlink=True)
coll = bpy.data.collections.get('Flame')
if coll is None:
    coll = bpy.data.collections.new('Flame')
    bpy.context.scene.collection.children.link(coll)

for o in bpy.context.selected_objects:
    o.select_set(False)

random.seed(11)
bm = bmesh.new()
uv_layer = bm.loops.layers.uv.new('UVMap')
uv_of = {}

# thin wisps
count = 8
heights = [0.22, 0.15, 0.19, 0.135, 0.205, 0.16, 0.18, 0.145]
widths = [0.024, 0.020, 0.023, 0.018, 0.025, 0.020, 0.022, 0.019]
for k in range(count):
    ang = k * 2 * math.pi / count + (0.18 if k % 2 else 0.0)
    add_tongue(bm, uv_layer, uv_of, ang, heights[k], widths[k],
               random.random() * 6.28, 0.018 + 0.006 * (k % 3), 0.018)

# broad billows: fewer, curling outward for volume, but held closer in
for k in range(4):
    ang = (k + 0.5) * 2 * math.pi / 4
    height = 0.115 + 0.022 * (k % 2) + random.random() * 0.010
    add_tongue(bm, uv_layer, uv_of, ang, height, 0.030 + 0.004 * (k % 3),
               random.random() * 6.28, 0.038, 0.026,
               thick=0.5, profile=0.45, flare=0.8)

bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
for f in bm.faces:
    for loop in f.loops:
        loop[uv_layer].uv = uv_of[loop.vert]

me = bpy.data.meshes.new('Flame_Tongues')
bm.to_mesh(me)
bm.free()
for p in me.polygons:
    p.use_smooth = True

ob = bpy.data.objects.new('Flame_Tongues', me)
coll.objects.link(ob)

mat = bpy.data.materials.new('Flame_Preview')
mat.use_nodes = True
bsdf = next(n for n in mat.node_tree.nodes if n.type == 'BSDF_PRINCIPLED')
bsdf.inputs['Base Color'].default_value = (1.0, 0.22, 0.02, 1.0)
if 'Emission Color' in bsdf.inputs:
    bsdf.inputs['Emission Color'].default_value = (1.0, 0.30, 0.02, 1.0)
    bsdf.inputs['Emission Strength'].default_value = 3.0
me.materials.append(mat)

ob.select_set(True)
bpy.context.view_layer.objects.active = ob

out = r'D:\GloveAR\flame.glb'
bpy.ops.export_scene.gltf(
    filepath=out,
    export_format='GLB',
    use_selection=True,
    export_apply=True,
)
print('exported', out, len(me.vertices), 'verts', len(me.polygons), 'faces')
