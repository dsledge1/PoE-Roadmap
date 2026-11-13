-- Dumps PoB tree + gem data to compact JSON for the tracker's PoB importer.
-- usage: luajit dump_pob_data.lua <PoB src dir> <out dir> <treeVersion...>
package.path = arg[1] .. "/../runtime/lua/?.lua;" .. package.path
local json = require("dkjson")
local src, out = arg[1], arg[2]
local function load(path) local f = assert(loadfile(path)); return f() end
local function write(name, obj) local fh = assert(io.open(out .. "/" .. name, "w")); fh:write(json.encode(obj)); fh:close() end

-- gems: name -> {c = r|g|b|w, s = support?, t = tags}
local gems = {}
for _, g in pairs(load(src .. "/Data/Gems.lua")) do
  local c = "w"
  local m = math.max(g.reqStr or 0, g.reqDex or 0, g.reqInt or 0)
  if m > 0 then
    if (g.reqStr or 0) == m then c = "r" elseif (g.reqDex or 0) == m then c = "g" else c = "b" end
  end
  local tags = {}
  for k, v in pairs(g.tags or {}) do if v then tags[#tags + 1] = k end end
  table.sort(tags)
  local e = { c = c, t = tags, s = (g.tags and g.tags.support) and 1 or 0 }
  gems[g.name] = e
  if g.grantedEffectId then gems["#" .. g.grantedEffectId] = g.name end
end
write("gems.json", gems)

for i = 3, #arg do
  local ver = arg[i]
  local t = load(src .. "/TreeData/" .. ver .. "/tree.lua")
  local groups = {}
  for id, g in pairs(t.groups) do groups[tostring(id)] = { math.floor(g.x * 10 + 0.5) / 10, math.floor(g.y * 10 + 0.5) / 10 } end
  local nodes = {}
  for id, n in pairs(t.nodes) do
    if type(n) == "table" and n.group and not n.isProxy and not n.ascendancyName and not n.isBlighted then
      local kind = n.isKeystone and "k" or n.isNotable and "n" or n.isMastery and "m" or n.isJewelSocket and "j" or (n.classStartIndex and "s") or "p"
      local outs = {}
      for _, o in ipairs(n.out or {}) do outs[#outs + 1] = tonumber(o) end
      nodes[tostring(id)] = { g = n.group, o = n.orbit or 0, i = n.orbitIndex or 0, k = kind, out = outs, n = n.name or "", cs = n.classStartIndex,
        st = (n.isNotable or n.isKeystone) and n.stats or nil }
    end
  end
  write("tree_" .. ver .. ".json", { version = ver, skillsPerOrbit = t.constants.skillsPerOrbit, orbitRadii = t.constants.orbitRadii, groups = groups, nodes = nodes,
    classes = (function() local c = {} for idx, cl in ipairs(t.classes) do c[idx] = cl.name end return c end)() })
end
print("ok")
