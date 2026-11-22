(module
 (type $0 (func (param i32 i32)))
 (type $1 (func (param i32 i32 i32 i32)))
 (type $2 (func))
 (type $3 (func (param i32 i32 f32 f32 f32 f32 f32 i32 i32) (result i32)))
 (global $assembly/index/tempHeight (mut f32) (f32.const 0))
 (global $assembly/index/tempDerivative (mut f32) (f32.const 0))
 (memory $0 10 10)
 (export "initTables" (func $assembly/index/initTables))
 (export "generateDisplacementBmp" (func $assembly/index/generateDisplacementBmp))
 (export "memory" (memory $0))
 (func $assembly/index/fillRowPixel (param $0 i32) (param $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  local.get $1
  i32.const 0
  i32.le_s
  if
   return
  end
  local.get $1
  i32.const 4
  i32.lt_s
  if
   loop $for-loop|0
    local.get $1
    local.get $2
    i32.gt_s
    if
     local.get $0
     local.get $2
     i32.const 2
     i32.shl
     i32.add
     i32.const -8355712
     i32.store
     local.get $2
     i32.const 1
     i32.add
     local.set $2
     br $for-loop|0
    end
   end
   return
  end
  local.get $0
  local.tee $2
  local.get $1
  i32.const -16
  i32.and
  i32.const 2
  i32.shl
  i32.add
  local.set $3
  loop $while-continue|1
   local.get $2
   local.get $3
   i32.lt_u
   if
    local.get $2
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store
    local.get $2
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=16
    local.get $2
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=32
    local.get $2
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=48
    local.get $2
    i32.const -64
    i32.sub
    local.set $2
    br $while-continue|1
   end
  end
  local.get $0
  local.get $1
  i32.const -4
  i32.and
  local.tee $3
  i32.const 2
  i32.shl
  i32.add
  local.set $4
  loop $while-continue|2
   local.get $2
   local.get $4
   i32.lt_u
   if
    local.get $2
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store
    local.get $2
    i32.const 16
    i32.add
    local.set $2
    br $while-continue|2
   end
  end
  local.get $1
  local.get $3
  i32.gt_s
  if
   local.get $0
   local.get $1
   i32.const 4
   i32.sub
   i32.const 2
   i32.shl
   i32.add
   v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
   v128.store
  end
 )
 (func $assembly/index/clearSpanClipped (param $0 i32) (param $1 i32) (param $2 i32) (param $3 i32)
  local.get $2
  local.get $0
  local.get $0
  local.get $2
  i32.lt_s
  select
  local.tee $2
  local.get $3
  local.get $0
  local.get $1
  i32.add
  local.tee $0
  local.get $0
  local.get $3
  i32.gt_s
  select
  local.tee $0
  i32.lt_s
  if
   local.get $2
   i32.const 2
   i32.shl
   i32.const 85056
   i32.add
   local.get $0
   local.get $2
   i32.sub
   call $assembly/index/fillRowPixel
  end
 )
 (func $assembly/index/initTables
  (local $0 f32)
  (local $1 f32)
  (local $2 i32)
  (local $3 v128)
  (local $4 v128)
  (local $5 f32)
  (local $6 f32)
  (local $7 f32)
  (local $8 f32)
  (local $9 f32)
  (local $10 v128)
  (local $11 f32)
  (local $12 i32)
  (local $13 v128)
  (local $14 i32)
  (local $15 v128)
  (local $16 v128)
  (local $17 v128)
  (local $18 i32)
  (local $19 v128)
  (local $20 i32)
  (local $21 f32)
  (local $22 i32)
  loop $for-loop|0
   local.get $20
   i32.const 4
   i32.lt_u
   if
    local.get $20
    i32.const 1536
    i32.mul
    i32.const 1024
    i32.add
    local.set $18
    local.get $20
    i32.const 9
    i32.shl
    i32.const 13312
    i32.add
    local.set $12
    i32.const 1
    local.set $14
    loop $for-loop|1
     local.get $14
     i32.const 127
     i32.lt_s
     if
      local.get $14
      f32.convert_i32_s
      f32.const 127
      f32.div
      local.set $9
      local.get $20
      if
       local.get $20
       i32.const 1
       i32.eq
       if
        f32.const 1
        f32.const 1
        local.get $9
        f32.sub
        local.tee $1
        local.get $1
        f32.mul
        local.tee $0
        f32.sub
        f32.const 1.000000013351432e-10
        f64.const 1
        local.get $0
        f64.promote_f32
        f64.sub
        f64.const 1.000000013351432e-10
        f64.gt
        select
        f32.sqrt
        local.tee $0
        global.set $assembly/index/tempHeight
        local.get $1
        local.get $0
        f32.div
        global.set $assembly/index/tempDerivative
       else
        local.get $20
        i32.const 2
        i32.eq
        if
         f32.const 0
         f32.const 1
         local.get $9
         local.get $9
         f32.const 1
         f32.gt
         select
         local.get $9
         f32.const 0
         f32.lt
         select
         global.set $assembly/index/tempHeight
         f32.const 1
         f32.const 0
         local.get $9
         f32.const 1
         f32.lt
         local.get $9
         f32.const 0
         f32.gt
         i32.and
         select
         global.set $assembly/index/tempDerivative
        else
         local.get $9
         f32.const 1
         local.get $9
         f32.sub
         f32.mul
         local.tee $5
         local.get $5
         f32.mul
         local.set $8
         f32.const 1
         local.get $5
         f32.const 16
         f32.mul
         f32.const 5
         local.get $5
         f32.const 4
         f32.mul
         f32.sub
         f32.div
         local.tee $6
         local.get $6
         f32.mul
         local.tee $0
         f32.sub
         f32.const 0
         f64.const 1
         local.get $0
         f64.promote_f32
         f64.sub
         f64.const 0
         f64.gt
         select
         f32.sqrt
         local.set $1
         local.get $9
         local.get $9
         f32.mul
         local.tee $7
         f32.const 3
         local.get $9
         local.get $9
         f32.add
         local.tee $0
         f32.sub
         f32.mul
         local.get $8
         f32.const 0.15000000596046448
         f32.mul
         local.get $6
         f32.mul
         f32.sub
         local.set $11
         local.get $5
         f32.const 6
         f32.mul
         local.get $5
         local.get $5
         f32.add
         f32.const 1
         local.get $0
         f32.sub
         local.tee $5
         f32.mul
         local.get $6
         f32.mul
         local.get $8
         f32.const 3.1415927410125732
         f32.mul
         local.get $1
         local.get $1
         f32.neg
         local.get $9
         f32.const 0.5
         f32.le
         select
         f32.mul
         f32.add
         f32.const 0.15000000596046448
         f32.mul
         f32.sub
         local.set $6
         local.get $9
         f32.const 0.5
         f32.lt
         if (result f32)
          f32.const 1
          local.get $5
          local.get $5
          f32.mul
          local.tee $1
          local.get $1
          f32.mul
          local.tee $0
          f32.sub
          f32.const 1.000000013351432e-10
          f64.const 1
          local.get $0
          f64.promote_f32
          f64.sub
          f64.const 1.000000013351432e-10
          f64.gt
          select
          f32.sqrt
          local.tee $0
          f32.sqrt
          local.set $21
          local.get $5
          local.get $5
          f32.add
          local.get $1
          f32.mul
          local.get $21
          local.get $0
          f32.mul
          f32.div
         else
          f32.const 1
          local.set $21
          f32.const 0
         end
         local.get $21
         f32.const 1
         local.get $9
         f32.const 6
         f32.mul
         f32.const -15
         f32.add
         local.get $9
         f32.mul
         f32.const 10
         f32.add
         local.get $7
         f32.mul
         local.get $9
         f32.mul
         local.tee $1
         f32.sub
         local.tee $0
         f32.mul
         local.get $11
         local.get $1
         f32.mul
         f32.add
         global.set $assembly/index/tempHeight
         local.get $0
         f32.mul
         local.get $6
         local.get $1
         f32.mul
         f32.add
         local.get $11
         local.get $21
         f32.sub
         local.get $8
         f32.const 30
         f32.mul
         f32.mul
         f32.add
         global.set $assembly/index/tempDerivative
        end
       end
      else
       f32.const 1
       f32.const 1
       local.get $9
       f32.sub
       local.tee $6
       local.get $6
       f32.mul
       local.tee $5
       local.get $5
       f32.mul
       local.tee $0
       f32.sub
       f32.const 1.000000013351432e-10
       f64.const 1
       local.get $0
       f64.promote_f32
       f64.sub
       f64.const 1.000000013351432e-10
       f64.gt
       select
       f32.sqrt
       local.tee $1
       f32.sqrt
       local.tee $0
       local.get $1
       f32.mul
       local.set $1
       local.get $0
       f32.const 0.699999988079071
       f32.mul
       f32.const 1
       local.get $5
       f32.sub
       f32.const 1.000000013351432e-10
       f64.const 1
       local.get $5
       f64.promote_f32
       f64.sub
       f64.const 1.000000013351432e-10
       f64.gt
       select
       f32.sqrt
       local.tee $0
       f32.const 0.30000001192092896
       f32.mul
       f32.add
       global.set $assembly/index/tempHeight
       local.get $6
       local.get $5
       f32.const 0.699999988079071
       f32.mul
       local.get $0
       f32.mul
       local.get $1
       f32.const 0.30000001192092896
       f32.mul
       f32.add
       f32.mul
       f32.const 1
       local.get $0
       local.get $1
       f32.mul
       f32.div
       f32.mul
       global.set $assembly/index/tempDerivative
      end
      global.get $assembly/index/tempDerivative
      local.tee $5
      local.get $5
      f32.mul
      local.tee $1
      f32.const 1
      f32.add
      local.set $0
      local.get $14
      i32.const 2
      i32.shl
      local.tee $2
      local.get $18
      i32.add
      local.get $1
      local.get $0
      f32.div
      f32.store
      local.get $2
      local.get $12
      i32.add
      local.get $0
      f32.sqrt
      f32.store
      local.get $2
      local.get $18
      i32.const 512
      i32.add
      i32.add
      local.get $5
      local.get $1
      f32.const 0.11999999731779099
      f32.mul
      f32.const 1
      f32.add
      f32.sqrt
      f32.sqrt
      f32.div
      local.tee $1
      global.get $assembly/index/tempHeight
      f32.const 0
      global.get $assembly/index/tempHeight
      f32.const 0
      f32.gt
      select
      local.tee $0
      f32.mul
      f32.store
      local.get $2
      local.get $18
      i32.const 1024
      i32.add
      i32.add
      local.get $1
      local.get $0
      local.get $0
      f32.sqrt
      f32.mul
      f32.sqrt
      f32.mul
      f32.store
      local.get $14
      i32.const 1
      i32.add
      local.set $14
      br $for-loop|1
     end
    end
    local.get $18
    f32.const 0
    f32.store
    local.get $12
    f32.const 1
    f32.store
    local.get $18
    f32.const 0
    f32.store offset=512
    local.get $18
    i32.const 1024
    i32.add
    f32.const 0
    f32.store
    local.get $18
    f32.const 0
    f32.store offset=508
    local.get $12
    f32.const 1
    f32.store offset=508
    local.get $18
    f32.const 0
    f32.store offset=1020
    local.get $18
    i32.const 1532
    i32.add
    f32.const 0
    f32.store
    local.get $20
    i32.const 1
    i32.add
    local.set $20
    br $for-loop|0
   end
  end
  loop $for-loop|2
   local.get $22
   i32.const 16
   i32.lt_s
   if
    i32.const 0
    local.set $20
    loop $for-loop|3
     local.get $20
     i32.const 16
     i32.lt_s
     if
      local.get $22
      i32.const 4
      i32.shl
      local.get $20
      i32.or
      i32.const 2
      i32.shl
      i32.const 7168
      i32.add
      local.get $20
      f32.convert_i32_s
      f32.const 0.0671105608344078
      f32.mul
      local.get $22
      f32.convert_i32_s
      f32.const 0.005837149918079376
      f32.mul
      f32.add
      local.tee $0
      local.get $0
      f32.floor
      f32.sub
      f32.const 52.98291778564453
      f32.mul
      local.tee $0
      local.get $0
      f32.floor
      f32.sub
      f32.const 127.5
      f32.add
      f32.store
      local.get $20
      i32.const 1
      i32.add
      local.set $20
      br $for-loop|3
     end
    end
    local.get $22
    i32.const 1
    i32.add
    local.set $22
    br $for-loop|2
   end
  end
  i32.const 84992
  i32.const 19778
  i32.store16
  i32.const 84994
  i32.const 64
  i32.store
  i32.const 84998
  i32.const 0
  i32.store
  i32.const 85002
  i32.const 64
  i32.store
  i32.const 85006
  i32.const 40
  i32.store
  i32.const 85010
  i32.const 0
  i32.store
  i32.const 85014
  i32.const 0
  i32.store
  i32.const 85018
  i32.const 1
  i32.store16
  i32.const 85020
  i32.const 32
  i32.store16
  i32.const 85022
  i32.const 0
  i32.store
  i32.const 85026
  i32.const 0
  i32.store
  i32.const 85030
  i32.const 2835
  i32.store
  i32.const 85034
  i32.const 2835
  i32.store
  i32.const 85038
  i32.const 0
  i32.store
  i32.const 85042
  i32.const 0
  i32.store
  i32.const 54
  local.set $22
  loop $for-loop|4
   local.get $22
   i32.const 64
   i32.lt_u
   if
    local.get $22
    i32.const 84992
    i32.add
    i32.const 0
    i32.store8
    local.get $22
    i32.const 1
    i32.add
    local.set $22
    br $for-loop|4
   end
  end
  i32.const 85056
  local.set $22
  loop $while-continue|5
   local.get $22
   i32.const 642112
   i32.lt_u
   if
    local.get $22
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store
    local.get $22
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=16
    local.get $22
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=32
    local.get $22
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=48
    local.get $22
    i32.const -64
    i32.sub
    local.set $22
    br $while-continue|5
   end
  end
  i32.const 0
  local.set $22
  loop $for-loop|6
   local.get $22
   i32.const 8
   i32.lt_u
   if
    local.get $22
    i32.const 2
    i32.shl
    local.tee $2
    i32.const 10240
    i32.add
    i32.const -1
    i32.store
    local.get $2
    i32.const 10336
    i32.add
    i32.const -1
    i32.store
    local.get $22
    i32.const 1
    i32.add
    local.set $22
    br $for-loop|6
   end
  end
  i32.const 0
  local.set $22
  loop $for-loop|7
   local.get $22
   i32.const 4
   i32.lt_u
   if
    local.get $22
    i32.const 2
    i32.shl
    local.tee $2
    i32.const 10400
    i32.add
    i32.const -1
    i32.store
    local.get $2
    i32.const 10416
    i32.add
    f32.const -1
    f32.store
    local.get $2
    i32.const 10432
    i32.add
    f32.const -1
    f32.store
    local.get $2
    i32.const 10448
    i32.add
    i32.const 0
    i32.store
    local.get $22
    i32.const 1
    i32.add
    local.set $22
    br $for-loop|7
   end
  end
  v128.const i32x4 0xbf800000 0xbf800000 0xbf800000 0xbf800000
  local.set $19
  v128.const i32x4 0xbf800000 0xbf800000 0xbf800000 0xbf800000
  local.set $17
  v128.const i32x4 0x00000001 0x00000001 0x00000001 0x00000001
  local.set $16
  v128.const i32x4 0x00000001 0x00000001 0x00000001 0x00000001
  local.set $15
  v128.const i32x4 0x00000000 0x00000001 0x00000002 0x00000003
  local.set $13
  i32.const 0
  local.set $22
  loop $for-loop|8
   local.get $22
   i32.const 512
   i32.lt_u
   if
    v128.const i32x4 0x3f431579 0x3f431579 0x3f431579 0x3f431579
    v128.const i32x4 0x3f800000 0x3f800000 0x3f800000 0x3f800000
    v128.const i32x4 0x3e98f93e 0x3e98f93e 0x3e98f93e 0x3e98f93e
    v128.const i32x4 0x3e73aa1c 0x3e73aa1c 0x3e73aa1c 0x3e73aa1c
    local.get $22
    i32.const 1024
    i32.add
    v128.load
    f32x4.mul
    local.tee $4
    f32x4.mul
    f32x4.sub
    local.tee $3
    f32x4.mul
    local.get $3
    v128.const i32x4 0x3ef9c190 0x3ef9c190 0x3ef9c190 0x3ef9c190
    local.get $22
    i32.const 13312
    i32.add
    v128.load
    v128.const i32x4 0x3f7ffc55 0x3f7ffc55 0x3f7ffc55 0x3f7ffc55
    v128.const i32x4 0x3f4b78fc 0x3f4b78fc 0x3f4b78fc 0x3f4b78fc
    local.get $4
    f32x4.mul
    f32x4.sub
    f32x4.mul
    f32x4.mul
    f32x4.add
    f32x4.div
    local.tee $4
    local.get $22
    i32.const 1536
    i32.add
    v128.load
    f32x4.mul
    local.set $3
    local.get $4
    local.get $22
    i32.const 2048
    i32.add
    v128.load
    f32x4.mul
    local.set $4
    local.get $22
    i32.const -8192
    i32.sub
    local.get $3
    v128.store
    local.get $22
    i32.const 8704
    i32.add
    local.get $4
    v128.store
    local.get $3
    f32x4.abs
    local.tee $3
    local.get $19
    f32x4.gt
    local.set $10
    local.get $3
    local.get $19
    local.get $10
    v128.bitselect
    local.set $19
    local.get $13
    local.get $16
    local.get $10
    v128.bitselect
    local.set $16
    local.get $4
    f32x4.abs
    local.tee $4
    local.get $17
    f32x4.gt
    local.set $3
    local.get $4
    local.get $17
    local.get $3
    v128.bitselect
    local.set $17
    local.get $13
    local.get $15
    local.get $3
    v128.bitselect
    local.set $15
    local.get $13
    v128.const i32x4 0x00000004 0x00000004 0x00000004 0x00000004
    i32x4.add
    local.set $13
    local.get $22
    i32.const 16
    i32.add
    local.set $22
    br $for-loop|8
   end
  end
  i32.const 8192
  f32.const 0
  f32.store
  i32.const 8704
  f32.const 0
  f32.store
  i32.const 8700
  f32.const 0
  f32.store
  i32.const 9212
  f32.const 0
  f32.store
  local.get $16
  i32x4.extract_lane 0
  local.set $2
  local.get $19
  f32x4.extract_lane 0
  local.tee $0
  local.get $19
  f32x4.extract_lane 1
  local.tee $1
  f32.lt
  if
   local.get $1
   local.set $0
   local.get $16
   i32x4.extract_lane 1
   local.set $2
  end
  i32.const 52
  local.get $16
  i32x4.extract_lane 3
  local.get $19
  f32x4.extract_lane 2
  local.tee $1
  local.get $0
  f32.gt
  if (result i32)
   local.get $1
   local.set $0
   local.get $16
   i32x4.extract_lane 2
  else
   local.get $2
  end
  local.get $19
  f32x4.extract_lane 3
  local.get $0
  f32.gt
  select
  i32.store
  local.get $15
  i32x4.extract_lane 0
  local.set $2
  local.get $17
  f32x4.extract_lane 0
  local.tee $0
  local.get $17
  f32x4.extract_lane 1
  local.tee $1
  f32.lt
  if
   local.get $1
   local.set $0
   local.get $15
   i32x4.extract_lane 1
   local.set $2
  end
  i32.const 56
  local.get $15
  i32x4.extract_lane 3
  local.get $17
  f32x4.extract_lane 2
  local.tee $1
  local.get $0
  f32.gt
  if (result i32)
   local.get $1
   local.set $0
   local.get $15
   i32x4.extract_lane 2
  else
   local.get $2
  end
  local.get $17
  f32x4.extract_lane 3
  local.get $0
  f32.gt
  select
  i32.store
  i32.const 76
  i32.const 0
  i32.store
  i32.const 80
  f32.const 2.049999952316284
  f32.store
  i32.const 0
  i32.const 0
  i32.store
  i32.const 4
  i32.const 0
  i32.store
  i32.const 8
  i32.const 0
  i32.store
  i32.const 12
  i32.const 0
  i32.store
  i32.const 48
  i32.const 0
  i32.store
  i32.const 16
  i32.const -1
  i32.store
  i32.const 20
  i32.const -2
  i32.store
  i32.const 24
  f32.const 0
  f32.store
  i32.const 36
  f32.const 0
  f32.store
  i32.const 28
  f32.const 1
  f32.store
  i32.const 32
  f32.const 1
  f32.store
  i32.const 60
  i32.const -1
  i32.store
  i32.const 64
  f32.const -1
  f32.store
  i32.const 68
  f32.const -1
  f32.store
  i32.const 72
  f32.const -1
  f32.store
  i32.const 84
  i32.const 0
  i32.store
  i32.const 88
  i32.const 0
  i32.store
  i32.const 92
  i32.const 0
  i32.store
  i32.const 96
  i32.const -1
  i32.store
  i32.const 100
  i32.const 64
  i32.store
  i32.const 104
  f32.const -1
  f32.store
  i32.const 108
  f32.const -1
  f32.store
  i32.const 112
  i32.const 0
  i32.store
 )
 (func $assembly/index/generateDisplacementBmp (param $0 i32) (param $1 i32) (param $2 f32) (param $3 f32) (param $4 f32) (param $5 f32) (param $6 f32) (param $7 i32) (param $8 i32) (result i32)
  (local $9 i32)
  (local $10 i32)
  (local $11 f32)
  (local $12 i32)
  (local $13 v128)
  (local $14 i32)
  (local $15 i32)
  (local $16 v128)
  (local $17 v128)
  (local $18 i32)
  (local $19 i32)
  (local $20 i32)
  (local $21 f32)
  (local $22 i32)
  (local $23 i32)
  (local $24 i32)
  (local $25 f32)
  (local $26 f32)
  (local $27 i32)
  (local $28 i32)
  (local $29 i32)
  (local $30 i32)
  (local $31 i32)
  (local $32 i32)
  (local $33 i32)
  (local $34 v128)
  (local $35 v128)
  (local $36 i32)
  (local $37 i32)
  (local $38 i32)
  (local $39 i32)
  (local $40 v128)
  (local $41 v128)
  (local $42 v128)
  (local $43 v128)
  (local $44 v128)
  (local $45 v128)
  (local $46 i32)
  (local $47 i32)
  (local $48 i32)
  (local $49 i32)
  (local $50 i32)
  (local $51 i32)
  (local $52 i32)
  (local $53 i32)
  (local $54 i32)
  (local $55 i32)
  (local $56 i32)
  (local $57 i32)
  (local $58 i32)
  (local $59 i32)
  (local $60 f32)
  (local $61 f32)
  (local $62 f32)
  (local $63 f32)
  (local $64 f32)
  local.get $8
  i32.const 4
  i32.and
  i32.const 0
  i32.load
  local.tee $24
  local.get $0
  i32.xor
  i32.or
  i32.const 4
  i32.load
  local.tee $29
  local.get $1
  i32.xor
  i32.or
  local.get $8
  i32.const 60
  i32.load
  i32.xor
  i32.or
  local.get $7
  i32.const 16
  i32.load
  i32.xor
  i32.or
  if (result i32)
   i32.const 0
  else
   local.get $2
   i32.const 64
   f32.load
   f32.eq
  end
  if (result i32)
   local.get $3
   i32.const 68
   f32.load
   f32.eq
  else
   i32.const 0
  end
  if (result i32)
   local.get $4
   i32.const 72
   f32.load
   f32.eq
  else
   i32.const 0
  end
  if (result i32)
   local.get $5
   i32.const 36
   f32.load
   f32.eq
  else
   i32.const 0
  end
  if (result i32)
   local.get $6
   i32.const 24
   f32.load
   f32.eq
  else
   i32.const 0
  end
  if
   i32.const 100
   i32.load
   return
  end
  local.get $3
  local.get $5
  f32.mul
  local.tee $11
  f32.const 1
  local.get $11
  f32.const 1
  f32.gt
  select
  local.set $25
  local.get $0
  i32.const 1
  i32.shr_s
  f32.convert_i32_s
  local.tee $11
  local.get $1
  i32.const 1
  i32.shr_s
  f32.convert_i32_s
  local.tee $21
  local.get $11
  local.get $21
  f32.lt
  select
  local.tee $11
  local.get $11
  local.get $2
  local.get $5
  f32.mul
  local.tee $21
  f32.const 0
  local.get $21
  f32.const 0
  f32.gt
  select
  local.get $8
  i32.const 1
  i32.and
  local.get $21
  local.get $11
  f32.const -0.5
  f32.add
  f32.ge
  i32.or
  select
  local.tee $21
  local.get $11
  local.get $21
  f32.lt
  select
  local.tee $26
  f32.const -0.5
  f32.add
  f32.ceil
  i32.trunc_sat_f32_s
  local.tee $9
  i32.const 0
  i32.lt_s
  if
   i32.const 0
   local.set $9
  end
  local.get $8
  i32.const 2
  i32.and
  i32.const 0
  i32.ne
  local.set $31
  i32.const 0
  local.get $11
  i32.trunc_sat_f32_s
  local.get $9
  local.get $9
  local.get $11
  i32.trunc_sat_f32_s
  i32.gt_s
  select
  local.tee $9
  i32.const 64
  i32.gt_s
  if (result i32)
   i32.const 64
  else
   local.get $9
  end
  local.get $31
  select
  local.set $14
  local.get $25
  f32.ceil
  i32.trunc_sat_f32_s
  i32.const 1
  i32.add
  local.tee $9
  i32.const 0
  i32.le_s
  if
   i32.const 1
   local.set $9
  end
  i32.const 256
  local.get $9
  local.get $9
  i32.const 256
  i32.gt_s
  select
  local.tee $15
  local.get $25
  f32.const -0.5
  f32.add
  f32.ceil
  i32.trunc_sat_f32_s
  local.tee $9
  i32.const 0
  i32.lt_s
  if
   i32.const 0
   local.set $9
  end
  local.get $9
  local.get $9
  local.get $15
  i32.gt_s
  select
  local.tee $12
  local.get $0
  f32.convert_i32_s
  f32.const 0.5
  f32.mul
  f32.ceil
  i32.trunc_sat_f32_s
  local.tee $9
  local.get $9
  local.get $12
  i32.gt_s
  select
  local.set $28
  i32.const 0
  local.get $12
  local.get $1
  f32.convert_i32_s
  f32.const 0.5
  f32.mul
  f32.ceil
  i32.trunc_sat_f32_s
  local.tee $9
  local.get $9
  local.get $12
  i32.gt_s
  select
  local.get $31
  select
  local.set $32
  local.get $5
  f32.const 1e3
  f32.mul
  f32.const 0.5
  f32.add
  i32.trunc_sat_f32_s
  i32.const 4095
  i32.and
  local.get $7
  i32.const 7
  i32.and
  i32.const 29
  i32.shl
  i32.const 0
  local.get $4
  local.get $25
  f32.div
  f32.const 1e3
  f32.mul
  f32.const 0.5
  f32.add
  i32.trunc_sat_f32_s
  local.get $25
  f32.const 9.999999974752427e-07
  f32.le
  local.tee $19
  select
  local.tee $39
  i32.const 131071
  i32.and
  i32.const 12
  i32.shl
  i32.or
  i32.or
  local.set $22
  i32.const -1
  local.set $20
  local.get $8
  i32.const 4
  i32.and
  i32.const 0
  i32.ne
  local.tee $30
  i32.eqz
  if
   i32.const 0
   local.set $10
   loop $for-loop|0
    local.get $10
    i32.const 8
    i32.lt_s
    if
     block $for-break0
      local.get $10
      i32.const 2
      i32.shl
      local.tee $9
      i32.const 10240
      i32.add
      i32.load
      local.get $22
      i32.eq
      if
       local.get $9
       i32.const 10272
       i32.add
       f32.load
       local.get $6
       f32.eq
       if
        local.get $10
        local.set $20
        br $for-break0
       end
      end
      local.get $10
      i32.const 1
      i32.add
      local.set $10
      br $for-loop|0
     end
    end
   end
  end
  local.get $20
  i32.const 0
  i32.ge_s
  if
   local.get $20
   i32.const 9
   i32.shl
   i32.const 16384
   i32.add
   local.set $18
   local.get $20
   i32.const 2
   i32.shl
   i32.const 10304
   i32.add
   f32.load
   local.set $11
  else
   i32.const 84
   i32.const 84
   i32.load
   local.tee $20
   i32.const 1
   i32.add
   i32.const 7
   i32.and
   i32.store
   local.get $20
   i32.const 9
   i32.shl
   i32.const 16384
   i32.add
   local.set $18
   i32.const 0
   local.set $10
   loop $for-loop|1
    local.get $10
    i32.const 4
    i32.lt_s
    if
     local.get $10
     i32.const 2
     i32.shl
     local.tee $9
     i32.const 10400
     i32.add
     local.tee $27
     i32.load
     local.get $20
     i32.eq
     if
      local.get $27
      i32.const -1
      i32.store
      local.get $9
      i32.const 10448
      i32.add
      i32.const 0
      i32.store
     end
     local.get $10
     i32.const 1
     i32.add
     local.set $10
     br $for-loop|1
    end
   end
   i32.const 0
   local.set $10
   loop $for-loop|2
    local.get $10
    i32.const 8
    i32.lt_s
    if
     local.get $10
     i32.const 2
     i32.shl
     i32.const 10336
     i32.add
     local.tee $9
     i32.load
     local.tee $27
     i32.const 20
     i32.shr_u
     local.get $20
     i32.eq
     local.get $27
     i32.const -1
     i32.ne
     i32.and
     if
      local.get $9
      i32.const -1
      i32.store
     end
     local.get $10
     i32.const 1
     i32.add
     local.set $10
     br $for-loop|2
    end
   end
   local.get $7
   i32.const 76
   i32.load
   i32.ne
   if (result i32)
    i32.const 1
   else
    local.get $6
    i32.const 80
    f32.load
    f32.ne
   end
   if
    local.get $7
    i32.const 1536
    i32.mul
    i32.const 1024
    i32.add
    local.set $9
    local.get $7
    i32.const 9
    i32.shl
    i32.const 13312
    i32.add
    local.set $27
    f32.const 1
    local.get $6
    f32.div
    local.tee $11
    local.get $11
    f32.mul
    local.set $21
    local.get $11
    f32x4.splat
    local.set $40
    local.get $21
    f32x4.splat
    local.set $41
    f32.const 1
    local.get $21
    f32.sub
    f32x4.splat
    local.set $42
    v128.const i32x4 0xbf800000 0xbf800000 0xbf800000 0xbf800000
    local.set $13
    v128.const i32x4 0xbf800000 0xbf800000 0xbf800000 0xbf800000
    local.set $16
    v128.const i32x4 0x00000001 0x00000001 0x00000001 0x00000001
    local.set $17
    v128.const i32x4 0x00000001 0x00000001 0x00000001 0x00000001
    local.set $34
    v128.const i32x4 0x00000000 0x00000001 0x00000002 0x00000003
    local.set $35
    i32.const 0
    local.set $10
    loop $for-loop|3
     local.get $10
     i32.const 512
     i32.lt_u
     if
      local.get $42
      v128.const i32x4 0x3f800000 0x3f800000 0x3f800000 0x3f800000
      v128.const i32x4 0x3e98f93e 0x3e98f93e 0x3e98f93e 0x3e98f93e
      local.get $41
      local.get $9
      local.get $10
      i32.add
      v128.load
      f32x4.mul
      local.tee $43
      f32x4.mul
      f32x4.sub
      local.tee $44
      f32x4.mul
      local.get $44
      local.get $40
      local.get $10
      local.get $27
      i32.add
      v128.load
      v128.const i32x4 0x3f7ffc55 0x3f7ffc55 0x3f7ffc55 0x3f7ffc55
      v128.const i32x4 0x3f4b78fc 0x3f4b78fc 0x3f4b78fc 0x3f4b78fc
      local.get $43
      f32x4.mul
      f32x4.sub
      f32x4.mul
      f32x4.mul
      f32x4.add
      f32x4.div
      local.tee $43
      local.get $9
      i32.const 512
      i32.add
      local.get $10
      i32.add
      v128.load
      f32x4.mul
      local.set $44
      local.get $43
      local.get $9
      i32.const 1024
      i32.add
      local.get $10
      i32.add
      v128.load
      f32x4.mul
      local.set $43
      local.get $10
      i32.const -8192
      i32.sub
      local.get $44
      v128.store
      local.get $10
      i32.const 8704
      i32.add
      local.get $43
      v128.store
      local.get $44
      f32x4.abs
      local.tee $44
      local.get $13
      f32x4.gt
      local.set $45
      local.get $44
      local.get $13
      local.get $45
      v128.bitselect
      local.set $13
      local.get $35
      local.get $17
      local.get $45
      v128.bitselect
      local.set $17
      local.get $43
      f32x4.abs
      local.tee $43
      local.get $16
      f32x4.gt
      local.set $44
      local.get $43
      local.get $16
      local.get $44
      v128.bitselect
      local.set $16
      local.get $35
      local.get $34
      local.get $44
      v128.bitselect
      local.set $34
      local.get $35
      v128.const i32x4 0x00000004 0x00000004 0x00000004 0x00000004
      i32x4.add
      local.set $35
      local.get $10
      i32.const 16
      i32.add
      local.set $10
      br $for-loop|3
     end
    end
    i32.const 8192
    f32.const 0
    f32.store
    i32.const 8704
    f32.const 0
    f32.store
    i32.const 8700
    f32.const 0
    f32.store
    i32.const 9212
    f32.const 0
    f32.store
    local.get $17
    i32x4.extract_lane 0
    local.set $9
    local.get $13
    f32x4.extract_lane 0
    local.tee $11
    local.get $13
    f32x4.extract_lane 1
    local.tee $21
    f32.lt
    if
     local.get $21
     local.set $11
     local.get $17
     i32x4.extract_lane 1
     local.set $9
    end
    local.get $17
    i32x4.extract_lane 2
    local.set $10
    i32.const 52
    local.get $17
    i32x4.extract_lane 3
    local.get $13
    f32x4.extract_lane 2
    local.tee $21
    local.get $11
    f32.gt
    if (result i32)
     local.get $21
     local.set $11
     local.get $10
    else
     local.get $9
    end
    local.get $13
    f32x4.extract_lane 3
    local.get $11
    f32.gt
    select
    i32.store
    local.get $34
    i32x4.extract_lane 0
    local.set $9
    local.get $16
    f32x4.extract_lane 0
    local.tee $11
    local.get $16
    f32x4.extract_lane 1
    local.tee $21
    f32.lt
    if
     local.get $21
     local.set $11
     local.get $34
     i32x4.extract_lane 1
     local.set $9
    end
    local.get $34
    i32x4.extract_lane 2
    local.set $10
    i32.const 56
    local.get $34
    i32x4.extract_lane 3
    local.get $16
    f32x4.extract_lane 2
    local.tee $21
    local.get $11
    f32.gt
    if (result i32)
     local.get $21
     local.set $11
     local.get $10
    else
     local.get $9
    end
    local.get $16
    f32x4.extract_lane 3
    local.get $11
    f32.gt
    select
    i32.store
    i32.const 76
    local.get $7
    i32.store
    i32.const 80
    local.get $6
    f32.store
   end
   v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
   local.set $13
   i32.const 52
   i32.load
   local.tee $9
   i32.const 56
   i32.load
   local.tee $10
   local.get $9
   local.get $10
   i32.lt_s
   select
   i32.const -4
   i32.and
   local.get $9
   local.get $10
   local.get $9
   local.get $10
   i32.gt_s
   select
   i32.const 4
   i32.add
   i32.const -4
   i32.and
   local.tee $9
   i32.const 128
   i32.gt_s
   if
    i32.const 128
    local.set $9
   end
   f32.const 0
   local.get $4
   local.get $25
   f32.div
   local.get $19
   select
   f32x4.splat
   local.set $16
   i32.const 2
   i32.shl
   local.set $10
   loop $for-loop|4
    local.get $10
    local.get $9
    i32.const 2
    i32.shl
    i32.lt_u
    if
     local.get $13
     local.get $10
     i32.const -8192
     i32.sub
     v128.load
     local.get $16
     local.get $10
     i32.const 8704
     i32.add
     v128.load
     f32x4.mul
     f32x4.add
     f32x4.abs
     f32x4.max
     local.set $13
     local.get $10
     i32.const 16
     i32.add
     local.set $10
     br $for-loop|4
    end
   end
   local.get $13
   local.get $13
   local.get $13
   i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7
   f32x4.max
   local.tee $13
   local.get $13
   local.get $13
   i8x16.shuffle 4 5 6 7 0 1 2 3 12 13 14 15 8 9 10 11
   f32x4.max
   f32x4.extract_lane 0
   local.tee $11
   f32.const 0
   f32.le
   if
    f32.const 1
    local.set $11
   end
   local.get $16
   f32.const 127
   local.get $11
   f32.div
   f32x4.splat
   local.tee $34
   f32x4.mul
   local.set $35
   local.get $5
   f32.const 0.9900000095367432
   f32.lt
   local.get $5
   f32.const 0.05000000074505806
   f32.gt
   i32.and
   if
    f32.const 1
    local.get $5
    local.get $5
    f32.mul
    local.tee $21
    f32.sub
    local.get $21
    f32.const 8
    f32.mul
    f32.div
    local.tee $21
    f32.const 1.2000000476837158
    f32.gt
    if
     f32.const 1.2000000476837158
     local.set $21
    end
    local.get $21
    f32x4.splat
    local.set $40
    local.get $21
    local.get $21
    f32.add
    f32.const 1
    f32.add
    f32x4.splat
    local.set $41
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    local.set $16
    i32.const 8192
    v128.load
    local.get $34
    f32x4.mul
    i32.const 8704
    v128.load
    local.get $35
    f32x4.mul
    f32x4.add
    local.set $13
    i32.const 0
    local.set $10
    loop $for-loop|6
     local.get $10
     i32.const 496
     i32.lt_u
     if
      local.get $10
      local.get $18
      i32.add
      v128.const i32x4 0x42fe0000 0x42fe0000 0x42fe0000 0x42fe0000
      v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
      local.get $13
      local.get $41
      f32x4.mul
      local.get $40
      local.get $16
      local.get $13
      i8x16.shuffle 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27
      local.get $13
      local.get $10
      i32.const 16
      i32.add
      local.tee $10
      i32.const -8192
      i32.sub
      v128.load
      local.get $34
      f32x4.mul
      local.get $10
      i32.const 8704
      i32.add
      v128.load
      local.get $35
      f32x4.mul
      f32x4.add
      local.tee $17
      i8x16.shuffle 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19
      f32x4.add
      f32x4.mul
      f32x4.sub
      f32x4.max
      f32x4.min
      v128.store
      local.get $13
      local.set $16
      local.get $17
      local.set $13
      br $for-loop|6
     end
    end
    local.get $18
    v128.const i32x4 0x42fe0000 0x42fe0000 0x42fe0000 0x42fe0000
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    local.get $13
    local.get $41
    f32x4.mul
    local.get $40
    local.get $16
    local.get $13
    i8x16.shuffle 12 13 14 15 16 17 18 19 20 21 22 23 24 25 26 27
    local.get $13
    v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
    i8x16.shuffle 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19
    f32x4.add
    f32x4.mul
    f32x4.sub
    f32x4.max
    f32x4.min
    v128.store offset=496
   else
    i32.const 0
    local.set $10
    loop $for-loop|5
     local.get $10
     i32.const 512
     i32.lt_u
     if
      local.get $10
      local.get $18
      i32.add
      local.get $10
      i32.const -8192
      i32.sub
      v128.load
      local.get $34
      f32x4.mul
      local.get $10
      i32.const 8704
      i32.add
      v128.load
      local.get $35
      f32x4.mul
      f32x4.add
      v128.store
      local.get $10
      i32.const 16
      i32.add
      local.set $10
      br $for-loop|5
     end
    end
   end
   local.get $18
   f32.const 0
   f32.store
   local.get $18
   f32.const 0
   f32.store offset=508
   local.get $20
   i32.const 2
   i32.shl
   local.tee $9
   i32.const 10240
   i32.add
   local.get $22
   i32.store
   local.get $9
   i32.const 10272
   i32.add
   local.get $6
   f32.store
   local.get $9
   i32.const 10304
   i32.add
   local.get $11
   f32.store
  end
  i32.const 32
  f32.const 1
  local.get $4
  local.get $11
  f32.mul
  local.get $3
  local.get $11
  f32.mul
  local.get $19
  select
  local.tee $21
  local.get $21
  f32.const 0
  f32.le
  select
  f32.store
  i32.const 28
  local.get $11
  f32.store
  i32.const -1
  local.set $10
  local.get $30
  i32.eqz
  local.get $31
  i32.eqz
  local.get $14
  i32.const 0
  i32.gt_s
  i32.and
  i32.and
  if
   i32.const 0
   local.set $9
   loop $for-loop|7
    local.get $9
    i32.const 4
    i32.lt_s
    if
     block $for-break7
      local.get $9
      i32.const 2
      i32.shl
      local.tee $19
      i32.const 10400
      i32.add
      i32.load
      local.get $20
      i32.eq
      if
       local.get $25
       local.get $19
       i32.const 10432
       i32.add
       f32.load
       f32.sub
       local.tee $11
       f32.neg
       local.get $11
       local.get $11
       f32.const 0
       f32.lt
       select
       f32.const 9.999999747378752e-05
       f32.le
       local.get $26
       local.get $19
       i32.const 10416
       i32.add
       f32.load
       f32.sub
       local.tee $11
       f32.neg
       local.get $11
       local.get $11
       f32.const 0
       f32.lt
       select
       f32.const 9.999999747378752e-05
       f32.le
       i32.and
       if
        local.get $9
        local.set $10
        local.get $19
        i32.const 10448
        i32.add
        i32.load
        i32.const 0
        i32.ne
        local.set $36
        br $for-break7
       end
      end
      local.get $9
      i32.const 1
      i32.add
      local.set $9
      br $for-loop|7
     end
    end
   end
  end
  i32.const 96
  i32.load
  local.set $22
  i32.const 112
  i32.load
  local.set $27
  local.get $1
  local.get $29
  i32.eq
  local.get $0
  local.get $24
  i32.eq
  i32.and
  i32.const 8
  i32.load
  local.tee $33
  local.get $14
  i32.eq
  i32.and
  i32.const 12
  i32.load
  local.tee $46
  local.get $32
  i32.eq
  i32.and
  i32.const 48
  i32.load
  local.tee $47
  local.get $28
  i32.eq
  i32.and
  i32.const 104
  f32.load
  local.tee $11
  local.get $26
  f32.eq
  i32.and
  i32.const 108
  f32.load
  local.tee $21
  local.get $25
  f32.eq
  i32.and
  local.tee $38
  i32.eqz
  local.get $24
  local.get $29
  i32.mul
  local.tee $48
  i32.const 0
  i32.gt_s
  i32.and
  local.get $0
  local.get $32
  i32.mul
  i32.const 0
  local.get $31
  i32.eqz
  local.get $0
  local.get $14
  i32.const 1
  i32.shl
  i32.sub
  i32.const 0
  i32.gt_s
  i32.and
  local.get $32
  i32.const 0
  i32.gt_s
  i32.and
  local.tee $49
  select
  local.tee $50
  local.get $1
  local.get $32
  i32.sub
  local.get $0
  i32.mul
  local.get $0
  local.get $1
  i32.mul
  local.tee $37
  local.get $49
  select
  local.tee $51
  i32.lt_s
  i32.and
  if
   local.get $48
   i32.const 131072
   i32.gt_s
   if
    i32.const 85056
    local.set $9
    loop $while-continue|8
     local.get $9
     i32.const 609344
     i32.lt_u
     if
      local.get $9
      v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
      v128.store
      local.get $9
      i32.const 16
      i32.add
      local.set $9
      br $while-continue|8
     end
    end
    i32.const 0
    local.set $27
   else
    local.get $48
    local.get $50
    i32.gt_s
    if
     i32.const 10752
     i32.const 10496
     local.get $22
     i32.const 9
     i32.shl
     i32.const 53248
     i32.add
     local.get $22
     i32.const 0
     i32.lt_s
     local.tee $9
     select
     local.tee $52
     i32.const 256
     i32.add
     local.get $9
     select
     local.set $53
     local.get $50
     local.get $24
     i32.div_s
     local.set $9
     local.get $51
     i32.const 1
     i32.sub
     local.get $24
     i32.div_s
     local.tee $19
     local.get $29
     i32.ge_s
     if
      local.get $29
      i32.const 1
      i32.sub
      local.set $19
     end
     local.get $24
     local.get $33
     i32.const 1
     i32.shl
     i32.sub
     local.set $54
     local.get $24
     local.get $47
     i32.sub
     local.set $55
     loop $for-loop|9
      local.get $9
      local.get $19
      i32.le_s
      if
       local.get $9
       local.get $24
       i32.mul
       local.set $56
       local.get $9
       local.get $29
       i32.const 1
       i32.sub
       local.get $9
       i32.sub
       local.tee $57
       local.get $9
       local.get $57
       i32.lt_s
       select
       local.tee $57
       local.get $33
       i32.lt_s
       if
        local.get $57
        i32.const 2
        i32.shl
        local.tee $58
        local.get $52
        i32.add
        i32.load
        local.tee $59
        local.get $53
        local.get $58
        i32.add
        i32.load
        local.tee $58
        i32.lt_s
        if
         local.get $56
         local.get $59
         i32.add
         local.get $58
         local.get $59
         i32.sub
         local.tee $59
         local.get $50
         local.get $51
         call $assembly/index/clearSpanClipped
         local.get $24
         local.get $56
         i32.add
         local.get $58
         i32.sub
         local.get $59
         local.get $50
         local.get $51
         call $assembly/index/clearSpanClipped
        end
       end
       local.get $46
       local.get $57
       i32.gt_s
       local.get $54
       i32.const 0
       i32.gt_s
       i32.and
       if
        local.get $33
        local.get $56
        i32.add
        local.get $54
        local.get $50
        local.get $51
        call $assembly/index/clearSpanClipped
       end
       local.get $33
       local.get $57
       i32.le_s
       local.get $47
       i32.const 0
       i32.gt_s
       i32.and
       if
        local.get $56
        local.get $47
        local.get $50
        local.get $51
        call $assembly/index/clearSpanClipped
        local.get $55
        local.get $56
        i32.add
        local.get $47
        local.get $50
        local.get $51
        call $assembly/index/clearSpanClipped
       end
       local.get $9
       i32.const 1
       i32.add
       local.set $9
       br $for-loop|9
      end
     end
    end
    local.get $27
    local.get $50
    i32.gt_s
    local.get $27
    local.get $48
    i32.gt_s
    i32.and
    if
     local.get $48
     local.get $50
     local.get $48
     local.get $50
     i32.gt_s
     select
     local.tee $9
     local.get $27
     local.get $51
     local.get $27
     local.get $51
     i32.lt_s
     select
     local.tee $19
     i32.lt_s
     if
      local.get $9
      i32.const 2
      i32.shl
      i32.const 85056
      i32.add
      local.get $19
      local.get $9
      i32.sub
      call $assembly/index/fillRowPixel
     end
    end
   end
  end
  local.get $20
  i32.const 20
  i32.shl
  local.get $28
  i32.const 511
  i32.and
  i32.const 10
  i32.shl
  i32.or
  local.get $15
  i32.const 511
  i32.and
  i32.const 1
  i32.shl
  i32.or
  local.get $31
  i32.or
  local.set $29
  i32.const -1
  local.set $19
  local.get $30
  i32.eqz
  if
   i32.const 0
   local.set $9
   loop $for-loop|10
    local.get $9
    i32.const 8
    i32.lt_s
    if
     block $for-break10
      local.get $9
      i32.const 2
      i32.shl
      local.tee $24
      i32.const 10336
      i32.add
      i32.load
      local.get $29
      i32.eq
      if
       local.get $25
       local.get $24
       i32.const 10368
       i32.add
       f32.load
       f32.sub
       local.tee $60
       f32.neg
       local.get $60
       local.get $60
       f32.const 0
       f32.lt
       select
       f32.const 9.999999747378752e-05
       f32.le
       if
        local.get $9
        local.set $19
        br $for-break10
       end
      end
      local.get $9
      i32.const 1
      i32.add
      local.set $9
      br $for-loop|10
     end
    end
   end
  end
  local.get $37
  local.get $27
  local.get $27
  local.get $37
  i32.lt_s
  select
  local.set $46
  f32.const 127
  local.get $25
  f32.div
  local.set $60
  local.get $19
  i32.const 0
  i32.ge_s
  if
   local.get $19
   i32.const 12
   i32.shl
   i32.const 20480
   i32.add
   local.tee $33
   i32.const 1024
   i32.add
   local.set $30
   local.get $33
   i32.const 2048
   i32.add
   local.set $27
   local.get $33
   i32.const 3072
   i32.add
   local.set $24
  else
   i32.const 88
   i32.const 88
   i32.load
   local.tee $19
   i32.const 1
   i32.add
   i32.const 7
   i32.and
   i32.store
   local.get $19
   i32.const 12
   i32.shl
   i32.const 20480
   i32.add
   local.tee $33
   i32.const 1024
   i32.add
   local.set $30
   local.get $33
   i32.const 2048
   i32.add
   local.set $27
   local.get $33
   i32.const 3072
   i32.add
   local.set $24
   local.get $12
   i32.const -4
   i32.and
   local.set $47
   local.get $60
   f32.const 4
   f32.mul
   f32x4.splat
   local.set $13
   local.get $60
   f32.const 0.5
   f32.mul
   f32x4.splat
   local.get $60
   f32.const 1.5
   f32.mul
   f32x4.replace_lane 1
   local.get $60
   f32.const 2.5
   f32.mul
   f32x4.replace_lane 2
   local.get $60
   f32.const 3.5
   f32.mul
   f32x4.replace_lane 3
   local.set $17
   i32.const 0
   local.set $9
   loop $for-loop|11
    local.get $9
    local.get $47
    i32.lt_s
    if
     local.get $17
     i32x4.trunc_sat_f32x4_s
     v128.const i32x4 0x0000007e 0x0000007e 0x0000007e 0x0000007e
     i32x4.min_s
     local.tee $16
     i32.const 2
     i32x4.shl
     local.tee $34
     i32x4.extract_lane 1
     local.set $50
     local.get $34
     i32x4.extract_lane 0
     local.get $18
     i32.add
     local.tee $51
     f32.load
     f32x4.splat
     local.get $18
     local.get $50
     i32.add
     local.tee $50
     f32.load
     f32x4.replace_lane 1
     local.get $34
     i32x4.extract_lane 2
     local.get $18
     i32.add
     local.tee $52
     f32.load
     f32x4.replace_lane 2
     local.get $34
     i32x4.extract_lane 3
     local.get $18
     i32.add
     local.tee $53
     f32.load
     f32x4.replace_lane 3
     local.tee $34
     local.get $17
     local.get $16
     f32x4.convert_i32x4_s
     f32x4.sub
     local.get $51
     f32.load offset=4
     f32x4.splat
     local.get $50
     f32.load offset=4
     f32x4.replace_lane 1
     local.get $52
     f32.load offset=4
     f32x4.replace_lane 2
     local.get $53
     f32.load offset=4
     f32x4.replace_lane 3
     local.get $34
     f32x4.sub
     f32x4.mul
     f32x4.add
     local.get $9
     i32.const 12
     i32.and
     i32.const 2
     i32.shl
     i32.const 7168
     i32.add
     v128.load
     f32x4.add
     i32x4.trunc_sat_f32x4_u
     v128.const i32x4 0x000000ff 0x000000ff 0x000000ff 0x000000ff
     i32x4.min_u
     local.set $16
     local.get $9
     i32.const 2
     i32.shl
     local.set $50
     local.get $31
     i32.eqz
     if
      local.get $33
      local.get $50
      i32.add
      v128.const i32x4 0xff800080 0xff800080 0xff800080 0xff800080
      local.get $16
      i32.const 8
      i32x4.shl
      v128.or
      local.tee $34
      v128.store
      local.get $30
      local.get $50
      i32.add
      local.get $34
      v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
      v128.xor
      v128.store
     end
     local.get $27
     local.get $50
     i32.add
     v128.const i32x4 0xff008080 0xff008080 0xff008080 0xff008080
     local.get $16
     i32.const 16
     i32x4.shl
     v128.or
     local.tee $16
     v128.store
     local.get $24
     local.get $50
     i32.add
     local.get $16
     v128.const i32x4 0x00ff0000 0x00ff0000 0x00ff0000 0x00ff0000
     v128.xor
     v128.store
     local.get $17
     local.get $13
     f32x4.add
     local.set $17
     local.get $9
     i32.const 4
     i32.add
     local.set $9
     br $for-loop|11
    end
   end
   loop $for-loop|12
    local.get $9
    local.get $12
    i32.lt_s
    if
     i32.const 255
     i32.const 255
     local.get $18
     local.get $9
     f32.convert_i32_s
     f32.const 0.5
     f32.add
     local.get $60
     f32.mul
     local.tee $61
     i32.trunc_sat_f32_s
     local.tee $47
     i32.const 2
     i32.shl
     i32.add
     f32.load
     local.tee $62
     local.get $61
     local.get $47
     f32.convert_i32_s
     f32.sub
     local.get $18
     i32.const 127
     local.get $47
     i32.const 1
     i32.add
     local.tee $47
     local.get $47
     i32.const 127
     i32.ge_s
     select
     i32.const 2
     i32.shl
     i32.add
     f32.load
     local.get $62
     f32.sub
     f32.mul
     f32.add
     local.get $9
     i32.const 15
     i32.and
     i32.const 2
     i32.shl
     i32.const 7168
     i32.add
     f32.load
     f32.add
     i32.trunc_sat_f32_s
     local.tee $47
     local.get $47
     i32.const 255
     i32.gt_s
     select
     i32.const 0
     local.get $47
     i32.const 0
     i32.ge_s
     select
     local.tee $47
     i32.sub
     local.set $50
     local.get $9
     i32.const 2
     i32.shl
     local.set $51
     local.get $31
     i32.eqz
     if
      local.get $33
      local.get $51
      i32.add
      local.get $47
      i32.const 8
      i32.shl
      i32.const -8388480
      i32.or
      i32.store
      local.get $30
      local.get $51
      i32.add
      local.get $50
      i32.const 8
      i32.shl
      i32.const -8388480
      i32.or
      i32.store
     end
     local.get $27
     local.get $51
     i32.add
     local.get $47
     i32.const 16
     i32.shl
     i32.const -16744320
     i32.or
     i32.store
     local.get $24
     local.get $51
     i32.add
     local.get $50
     i32.const 16
     i32.shl
     i32.const -16744320
     i32.or
     i32.store
     local.get $9
     i32.const 1
     i32.add
     local.set $9
     br $for-loop|12
    end
   end
   loop $for-loop|13
    local.get $12
    local.get $15
    i32.lt_s
    if
     local.get $12
     i32.const 2
     i32.shl
     local.set $9
     local.get $31
     i32.eqz
     if
      local.get $9
      local.get $33
      i32.add
      i32.const -8355712
      i32.store
      local.get $9
      local.get $30
      i32.add
      i32.const -8355712
      i32.store
     end
     local.get $9
     local.get $27
     i32.add
     i32.const -8355712
     i32.store
     local.get $9
     local.get $24
     i32.add
     i32.const -8355712
     i32.store
     local.get $12
     i32.const 1
     i32.add
     local.set $12
     br $for-loop|13
    end
   end
   i32.const 0
   local.set $9
   loop $for-loop|14
    local.get $9
    local.get $28
    i32.const 1
    i32.shr_s
    i32.lt_s
    if
     local.get $24
     local.get $9
     i32.const 2
     i32.shl
     i32.add
     local.tee $12
     i32.load
     local.set $15
     local.get $12
     local.get $24
     local.get $28
     i32.const 1
     i32.sub
     local.get $9
     i32.sub
     i32.const 2
     i32.shl
     i32.add
     local.tee $12
     i32.load
     i32.store
     local.get $12
     local.get $15
     i32.store
     local.get $9
     i32.const 1
     i32.add
     local.set $9
     br $for-loop|14
    end
   end
   local.get $19
   i32.const 2
   i32.shl
   local.tee $9
   i32.const 10336
   i32.add
   local.get $29
   i32.store
   local.get $9
   i32.const 10368
   i32.add
   local.get $25
   f32.store
  end
  local.get $49
  local.get $38
  i32.eqz
  local.get $48
  i32.const 0
  i32.gt_s
  i32.and
  i32.and
  local.set $47
  local.get $31
  i32.eqz
  local.get $14
  i32.const 0
  i32.gt_s
  i32.and
  if
   local.get $10
   i32.const 0
   i32.ge_s
   local.get $36
   i32.and
   if
    local.get $10
    i32.const 9
    i32.shl
    i32.const 53248
    i32.add
    local.tee $15
    i32.const 256
    i32.add
    local.set $18
    local.get $10
    i32.const 13
    i32.shl
    i32.const 609344
    i32.add
    local.tee $9
    i32.const 4096
    i32.add
    local.set $12
    loop $for-loop|15
     local.get $14
     local.get $23
     i32.gt_s
     if
      local.get $23
      i32.const 2
      i32.shl
      local.tee $19
      local.get $15
      i32.add
      i32.load
      local.set $20
      local.get $18
      local.get $19
      i32.add
      i32.load
      local.set $22
      local.get $0
      local.get $23
      i32.mul
      i32.const 2
      i32.shl
      i32.const 85056
      i32.add
      local.set $29
      local.get $1
      i32.const 1
      i32.sub
      local.get $23
      i32.sub
      local.get $0
      i32.mul
      i32.const 2
      i32.shl
      i32.const 85056
      i32.add
      local.set $36
      local.get $23
      local.get $32
      i32.lt_s
      i32.const 0
      local.get $47
      select
      if
       local.get $20
       i32.const 0
       i32.gt_s
       if
        local.get $29
        local.get $20
        call $assembly/index/fillRowPixel
        local.get $0
        local.get $20
        i32.sub
        i32.const 2
        i32.shl
        local.tee $19
        local.get $29
        i32.add
        local.get $20
        call $assembly/index/fillRowPixel
        local.get $36
        local.get $20
        call $assembly/index/fillRowPixel
        local.get $19
        local.get $36
        i32.add
        local.get $20
        call $assembly/index/fillRowPixel
       end
       local.get $14
       local.get $22
       i32.gt_s
       if
        local.get $22
        i32.const 2
        i32.shl
        local.tee $19
        local.get $29
        i32.add
        local.get $14
        local.get $22
        i32.sub
        local.tee $48
        call $assembly/index/fillRowPixel
        local.get $0
        local.get $14
        i32.sub
        i32.const 2
        i32.shl
        local.tee $49
        local.get $29
        i32.add
        local.get $48
        call $assembly/index/fillRowPixel
        local.get $19
        local.get $36
        i32.add
        local.get $48
        call $assembly/index/fillRowPixel
        local.get $36
        local.get $49
        i32.add
        local.get $48
        call $assembly/index/fillRowPixel
       end
      end
      local.get $20
      local.get $22
      i32.lt_s
      if
       local.get $20
       i32.const 2
       i32.shl
       local.set $48
       local.get $0
       local.get $22
       i32.sub
       i32.const 2
       i32.shl
       local.set $49
       i32.const 0
       local.set $19
       local.get $22
       local.get $20
       i32.sub
       local.tee $20
       i32.const -8
       i32.and
       local.set $22
       loop $for-loop|16
        local.get $19
        local.get $22
        i32.lt_s
        if
         local.get $19
         i32.const 2
         i32.shl
         local.tee $50
         local.get $9
         i32.add
         local.tee $51
         v128.load
         local.set $13
         local.get $51
         v128.load offset=16
         local.set $16
         local.get $12
         local.get $50
         i32.add
         local.tee $51
         v128.load
         local.set $17
         local.get $51
         v128.load offset=16
         local.set $34
         local.get $29
         local.get $48
         i32.add
         local.get $50
         i32.add
         local.tee $51
         local.get $13
         v128.store
         local.get $51
         local.get $16
         v128.store offset=16
         local.get $36
         local.get $48
         i32.add
         local.get $50
         i32.add
         local.tee $51
         local.get $13
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store
         local.get $51
         local.get $16
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store offset=16
         local.get $29
         local.get $49
         i32.add
         local.get $50
         i32.add
         local.tee $51
         local.get $17
         v128.store
         local.get $51
         local.get $34
         v128.store offset=16
         local.get $36
         local.get $49
         i32.add
         local.get $50
         i32.add
         local.tee $50
         local.get $17
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store
         local.get $50
         local.get $34
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store offset=16
         local.get $19
         i32.const 8
         i32.add
         local.set $19
         br $for-loop|16
        end
       end
       local.get $20
       i32.const -4
       i32.and
       local.set $22
       loop $for-loop|17
        local.get $19
        local.get $22
        i32.lt_s
        if
         local.get $19
         i32.const 2
         i32.shl
         local.tee $50
         local.get $9
         i32.add
         v128.load
         local.set $13
         local.get $12
         local.get $50
         i32.add
         v128.load
         local.set $16
         local.get $29
         local.get $48
         i32.add
         local.get $50
         i32.add
         local.get $13
         v128.store
         local.get $36
         local.get $48
         i32.add
         local.get $50
         i32.add
         local.get $13
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store
         local.get $29
         local.get $49
         i32.add
         local.get $50
         i32.add
         local.get $16
         v128.store
         local.get $36
         local.get $49
         i32.add
         local.get $50
         i32.add
         local.get $16
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store
         local.get $19
         i32.const 4
         i32.add
         local.set $19
         br $for-loop|17
        end
       end
       local.get $20
       local.get $22
       i32.gt_s
       if
        local.get $20
        i32.const 4
        i32.ge_s
        if
         local.get $20
         i32.const 4
         i32.sub
         i32.const 2
         i32.shl
         local.tee $19
         local.get $9
         i32.add
         v128.load
         local.set $13
         local.get $12
         local.get $19
         i32.add
         v128.load
         local.set $16
         local.get $29
         local.get $48
         i32.add
         local.get $19
         i32.add
         local.get $13
         v128.store
         local.get $36
         local.get $48
         i32.add
         local.get $19
         i32.add
         local.get $13
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store
         local.get $29
         local.get $49
         i32.add
         local.get $19
         i32.add
         local.get $16
         v128.store
         local.get $36
         local.get $49
         i32.add
         local.get $19
         i32.add
         local.get $16
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store
        else
         loop $for-loop|18
          local.get $19
          local.get $20
          i32.lt_s
          if
           local.get $19
           i32.const 2
           i32.shl
           local.tee $22
           local.get $9
           i32.add
           i32.load
           local.set $50
           local.get $12
           local.get $22
           i32.add
           i32.load
           local.set $51
           local.get $29
           local.get $48
           i32.add
           local.get $22
           i32.add
           local.get $50
           i32.store
           local.get $36
           local.get $48
           i32.add
           local.get $22
           i32.add
           local.get $50
           i32.const 65280
           i32.xor
           i32.store
           local.get $29
           local.get $49
           i32.add
           local.get $22
           i32.add
           local.get $51
           i32.store
           local.get $36
           local.get $49
           i32.add
           local.get $22
           i32.add
           local.get $51
           i32.const 65280
           i32.xor
           i32.store
           local.get $19
           i32.const 1
           i32.add
           local.set $19
           br $for-loop|18
          end
         end
        end
       end
       local.get $20
       i32.const 2
       i32.shl
       local.tee $19
       local.get $9
       i32.add
       local.set $9
       local.get $12
       local.get $19
       i32.add
       local.set $12
      end
      local.get $23
      i32.const 1
      i32.add
      local.set $23
      br $for-loop|15
     end
    end
   else
    local.get $22
    i32.const 0
    i32.ge_s
    local.get $11
    local.get $26
    f32.eq
    i32.and
    local.get $21
    local.get $25
    f32.eq
    i32.and
    if
     local.get $22
     local.set $10
    else
     i32.const 92
     i32.const 92
     i32.load
     local.tee $10
     i32.const 1
     i32.add
     i32.const 3
     i32.and
     i32.store
    end
    local.get $10
    i32.const 9
    i32.shl
    i32.const 53248
    i32.add
    local.tee $48
    i32.const 256
    i32.add
    local.set $49
    local.get $10
    i32.const 13
    i32.shl
    i32.const 609344
    i32.add
    local.tee $29
    i32.const 4096
    i32.add
    local.set $15
    i32.const 0
    local.set $36
    i32.const 1
    local.set $23
    local.get $26
    f32.const 0.5
    f32.add
    local.tee $11
    local.get $11
    f32.mul
    local.tee $21
    local.get $26
    local.get $25
    f32.sub
    f32.const 0
    local.get $25
    local.get $26
    f32.lt
    select
    local.tee $11
    local.get $11
    f32.mul
    local.tee $61
    f32.sub
    local.tee $11
    f32.const 127
    f32.div
    local.set $62
    f32.const 127
    local.get $11
    f32.div
    f32.const 0
    local.get $62
    f32.const 9.99999993922529e-09
    f32.gt
    select
    local.set $63
    local.get $61
    f32x4.splat
    local.get $61
    local.get $62
    f32.add
    f32x4.replace_lane 1
    local.get $61
    local.get $62
    local.get $62
    f32.add
    f32.add
    f32x4.replace_lane 2
    local.get $61
    local.get $62
    f32.const 3
    f32.mul
    f32.add
    f32x4.replace_lane 3
    local.set $17
    local.get $62
    f32.const 4
    f32.mul
    f32x4.splat
    local.set $13
    local.get $26
    f32x4.splat
    local.set $16
    local.get $25
    f32x4.splat
    local.set $34
    local.get $60
    f32x4.splat
    local.set $35
    i32.const 0
    local.set $9
    loop $for-loop|19
     local.get $9
     i32.const 128
     i32.lt_u
     if
      local.get $9
      i32.const 2
      i32.shl
      i32.const 12288
      i32.add
      v128.const i32x4 0x42fe0000 0x42fe0000 0x42fe0000 0x42fe0000
      v128.const i32x4 0x3f000000 0x3f000000 0x3f000000 0x3f000000
      local.get $16
      local.get $17
      v128.const i32x4 0x5f375a86 0x5f375a86 0x5f375a86 0x5f375a86
      local.get $17
      i32.const 1
      i32x4.shr_u
      i32x4.sub
      local.tee $40
      v128.const i32x4 0x3fc01d31 0x3fc01d31 0x3fc01d31 0x3fc01d31
      local.get $17
      v128.const i32x4 0x3f000000 0x3f000000 0x3f000000 0x3f000000
      f32x4.mul
      local.tee $41
      local.get $40
      local.get $40
      f32x4.mul
      f32x4.mul
      f32x4.sub
      f32x4.mul
      local.tee $40
      v128.const i32x4 0x3fc00000 0x3fc00000 0x3fc00000 0x3fc00000
      local.get $41
      local.get $40
      local.get $40
      f32x4.mul
      f32x4.mul
      f32x4.sub
      f32x4.mul
      local.get $17
      v128.const i32x4 0x2b8cbccc 0x2b8cbccc 0x2b8cbccc 0x2b8cbccc
      f32x4.gt
      v128.and
      local.tee $40
      f32x4.mul
      local.tee $41
      f32x4.sub
      local.tee $42
      f32x4.max
      local.get $35
      f32x4.mul
      local.tee $43
      i32x4.trunc_sat_f32x4_s
      v128.const i32x4 0x0000007e 0x0000007e 0x0000007e 0x0000007e
      i32x4.min_s
      local.tee $44
      i32.const 2
      i32x4.shl
      local.tee $45
      i32x4.extract_lane 0
      local.get $18
      i32.add
      local.tee $12
      f32.load
      f32x4.splat
      local.get $45
      i32x4.extract_lane 1
      local.get $18
      i32.add
      local.tee $19
      f32.load
      f32x4.replace_lane 1
      local.get $45
      i32x4.extract_lane 2
      local.get $18
      i32.add
      local.tee $22
      f32.load
      f32x4.replace_lane 2
      local.get $45
      i32x4.extract_lane 3
      local.get $18
      i32.add
      local.tee $50
      f32.load
      f32x4.replace_lane 3
      local.tee $45
      local.get $43
      local.get $44
      f32x4.convert_i32x4_s
      f32x4.sub
      local.get $12
      f32.load offset=4
      f32x4.splat
      local.get $19
      f32.load offset=4
      f32x4.replace_lane 1
      local.get $22
      f32.load offset=4
      f32x4.replace_lane 2
      local.get $50
      f32.load offset=4
      f32x4.replace_lane 3
      local.get $45
      f32x4.sub
      f32x4.mul
      f32x4.add
      v128.const i32x4 0x3f800000 0x3f800000 0x3f800000 0x3f800000
      v128.const i32x4 0x3da3d70a 0x3da3d70a 0x3da3d70a 0x3da3d70a
      v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
      v128.const i32x4 0x3f800000 0x3f800000 0x3f800000 0x3f800000
      local.get $42
      f32x4.sub
      f32x4.max
      local.tee $43
      local.get $43
      f32x4.mul
      f32x4.mul
      f32x4.add
      f32x4.mul
      f32x4.min
      v128.const i32x4 0x3f800000 0x3f800000 0x3f800000 0x3f800000
      v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
      local.get $42
      v128.const i32x4 0x3f000000 0x3f000000 0x3f000000 0x3f000000
      f32x4.add
      v128.const i32x4 0x40000000 0x40000000 0x40000000 0x40000000
      f32x4.mul
      f32x4.max
      f32x4.min
      f32x4.mul
      local.get $40
      f32x4.mul
      local.get $42
      v128.const i32x4 0xbf000000 0xbf000000 0xbf000000 0xbf000000
      f32x4.ge
      local.get $42
      local.get $34
      f32x4.lt
      v128.and
      local.get $41
      v128.const i32x4 0x358637bd 0x358637bd 0x358637bd 0x358637bd
      f32x4.gt
      v128.and
      v128.and
      v128.store
      local.get $17
      local.get $13
      f32x4.add
      local.set $17
      local.get $9
      i32.const 4
      i32.add
      local.set $9
      br $for-loop|19
     end
    end
    local.get $63
    f32x4.splat
    local.set $13
    local.get $14
    local.tee $9
    local.set $12
    i32.const 0
    local.set $19
    loop $for-loop|20
     local.get $14
     local.get $19
     i32.gt_s
     if
      local.get $26
      local.get $19
      f32.convert_i32_s
      f32.const 0.5
      f32.add
      f32.sub
      local.tee $60
      local.get $60
      f32.mul
      local.set $11
      loop $while-continue|21
       local.get $9
       i32.const 0
       i32.gt_s
       if
        local.get $21
        local.get $26
        local.get $9
        i32.const 1
        i32.sub
        local.tee $18
        f32.convert_i32_s
        f32.const 0.5
        f32.add
        f32.sub
        local.tee $62
        local.get $62
        f32.mul
        local.get $11
        f32.add
        f32.gt
        if
         local.get $18
         local.set $9
         br $while-continue|21
        end
       end
      end
      loop $while-continue|22
       local.get $12
       i32.const 0
       i32.gt_s
       if
        local.get $61
        local.get $26
        local.get $12
        i32.const 1
        i32.sub
        local.tee $18
        f32.convert_i32_s
        f32.const 0.5
        f32.add
        f32.sub
        local.tee $62
        local.get $62
        f32.mul
        local.get $11
        f32.add
        f32.gt
        if
         local.get $18
         local.set $12
         br $while-continue|22
        end
       end
      end
      local.get $19
      i32.const 2
      i32.shl
      local.tee $18
      local.get $48
      i32.add
      local.get $9
      i32.store
      local.get $18
      local.get $49
      i32.add
      local.get $12
      i32.store
      local.get $0
      local.get $19
      i32.mul
      i32.const 2
      i32.shl
      i32.const 85056
      i32.add
      local.set $50
      local.get $1
      i32.const 1
      i32.sub
      local.get $19
      i32.sub
      local.get $0
      i32.mul
      i32.const 2
      i32.shl
      i32.const 85056
      i32.add
      local.set $51
      local.get $19
      local.get $32
      i32.lt_s
      i32.const 0
      local.get $47
      select
      if
       local.get $9
       i32.const 0
       i32.gt_s
       if
        local.get $50
        local.get $9
        call $assembly/index/fillRowPixel
        local.get $0
        local.get $9
        i32.sub
        i32.const 2
        i32.shl
        local.tee $18
        local.get $50
        i32.add
        local.get $9
        call $assembly/index/fillRowPixel
        local.get $51
        local.get $9
        call $assembly/index/fillRowPixel
        local.get $18
        local.get $51
        i32.add
        local.get $9
        call $assembly/index/fillRowPixel
       end
       local.get $12
       local.get $14
       i32.lt_s
       if
        local.get $12
        i32.const 2
        i32.shl
        local.tee $18
        local.get $50
        i32.add
        local.get $14
        local.get $12
        i32.sub
        local.tee $22
        call $assembly/index/fillRowPixel
        local.get $0
        local.get $14
        i32.sub
        i32.const 2
        i32.shl
        local.tee $52
        local.get $50
        i32.add
        local.get $22
        call $assembly/index/fillRowPixel
        local.get $18
        local.get $51
        i32.add
        local.get $22
        call $assembly/index/fillRowPixel
        local.get $51
        local.get $52
        i32.add
        local.get $22
        call $assembly/index/fillRowPixel
       end
      end
      local.get $9
      local.get $12
      i32.lt_s
      if
       local.get $60
       f32x4.splat
       local.set $16
       local.get $23
       i32.const 0
       local.get $36
       local.get $12
       local.get $9
       i32.sub
       local.tee $52
       i32.add
       i32.const 1024
       i32.le_s
       select
       local.set $23
       local.get $11
       local.get $61
       f32.sub
       local.get $63
       f32.mul
       f32.const 0.5
       f32.add
       local.tee $62
       f32x4.splat
       local.set $34
       local.get $19
       i32.const 15
       i32.and
       i32.const 6
       i32.shl
       i32.const 7168
       i32.add
       local.set $53
       local.get $9
       local.set $18
       local.get $9
       local.get $52
       i32.const -4
       i32.and
       i32.add
       local.tee $22
       local.get $9
       i32.gt_s
       if
        local.get $26
        local.get $9
        f32.convert_i32_s
        f32.const 0.5
        f32.add
        f32.sub
        f32x4.splat
        v128.const i32x4 0x00000000 0x3f800000 0x40000000 0x40400000
        f32x4.sub
        local.set $17
        loop $for-loop|23
         local.get $18
         local.get $22
         i32.lt_s
         if
          v128.const i32x4 0xff000080 0xff000080 0xff000080 0xff000080
          local.get $17
          local.get $17
          f32x4.mul
          local.get $13
          f32x4.mul
          local.get $34
          f32x4.add
          i32x4.trunc_sat_f32x4_u
          v128.const i32x4 0x0000007f 0x0000007f 0x0000007f 0x0000007f
          i32x4.min_u
          i32.const 2
          i32x4.shl
          local.tee $35
          i32x4.extract_lane 0
          i32.const 12288
          i32.add
          f32.load
          f32x4.splat
          local.get $35
          i32x4.extract_lane 1
          i32.const 12288
          i32.add
          f32.load
          f32x4.replace_lane 1
          local.get $35
          i32x4.extract_lane 2
          i32.const 12288
          i32.add
          f32.load
          f32x4.replace_lane 2
          local.get $35
          i32x4.extract_lane 3
          i32.const 12288
          i32.add
          f32.load
          f32x4.replace_lane 3
          local.tee $35
          local.get $17
          f32x4.mul
          local.get $53
          local.get $18
          i32.const 12
          i32.and
          i32.const 2
          i32.shl
          i32.add
          v128.load
          local.tee $40
          f32x4.add
          i32x4.trunc_sat_f32x4_u
          v128.const i32x4 0x000000ff 0x000000ff 0x000000ff 0x000000ff
          i32x4.min_u
          i32.const 16
          i32x4.shl
          local.get $35
          local.get $16
          f32x4.mul
          local.get $40
          f32x4.add
          i32x4.trunc_sat_f32x4_u
          v128.const i32x4 0x000000ff 0x000000ff 0x000000ff 0x000000ff
          i32x4.min_u
          i32.const 8
          i32x4.shl
          v128.or
          v128.or
          local.tee $35
          local.get $35
          i8x16.shuffle 12 13 14 15 8 9 10 11 4 5 6 7 0 1 2 3
          local.tee $40
          v128.const i32x4 0x00ff0000 0x00ff0000 0x00ff0000 0x00ff0000
          v128.xor
          local.set $41
          local.get $18
          i32.const 2
          i32.shl
          local.tee $54
          local.get $50
          i32.add
          local.get $35
          v128.store
          local.get $51
          local.get $54
          i32.add
          local.get $35
          v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
          v128.xor
          v128.store
          local.get $0
          i32.const 4
          i32.sub
          local.get $18
          i32.sub
          i32.const 2
          i32.shl
          local.tee $54
          local.get $50
          i32.add
          local.get $41
          v128.store
          local.get $51
          local.get $54
          i32.add
          local.get $40
          v128.const i32x4 0x00ffff00 0x00ffff00 0x00ffff00 0x00ffff00
          v128.xor
          v128.store
          local.get $23
          if
           local.get $29
           local.get $18
           local.get $9
           i32.sub
           local.tee $54
           i32.const 2
           i32.shl
           i32.add
           local.get $35
           v128.store
           local.get $15
           local.get $52
           i32.const 4
           i32.sub
           local.get $54
           i32.sub
           i32.const 2
           i32.shl
           i32.add
           local.get $41
           v128.store
          end
          local.get $17
          v128.const i32x4 0x40800000 0x40800000 0x40800000 0x40800000
          f32x4.sub
          local.set $17
          local.get $18
          i32.const 4
          i32.add
          local.set $18
          br $for-loop|23
         end
        end
       end
       local.get $12
       local.get $18
       i32.gt_s
       if
        local.get $52
        i32.const 4
        i32.ge_s
        if
         v128.const i32x4 0xff000080 0xff000080 0xff000080 0xff000080
         local.get $26
         local.get $12
         i32.const 4
         i32.sub
         local.tee $18
         f32.convert_i32_s
         f32.const 0.5
         f32.add
         f32.sub
         f32x4.splat
         v128.const i32x4 0x00000000 0x3f800000 0x40000000 0x40400000
         f32x4.sub
         local.tee $17
         local.get $17
         f32x4.mul
         local.get $13
         f32x4.mul
         local.get $34
         f32x4.add
         i32x4.trunc_sat_f32x4_u
         v128.const i32x4 0x0000007f 0x0000007f 0x0000007f 0x0000007f
         i32x4.min_u
         i32.const 2
         i32x4.shl
         local.tee $34
         i32x4.extract_lane 0
         i32.const 12288
         i32.add
         f32.load
         f32x4.splat
         local.get $34
         i32x4.extract_lane 1
         i32.const 12288
         i32.add
         f32.load
         f32x4.replace_lane 1
         local.get $34
         i32x4.extract_lane 2
         i32.const 12288
         i32.add
         f32.load
         f32x4.replace_lane 2
         local.get $34
         i32x4.extract_lane 3
         i32.const 12288
         i32.add
         f32.load
         f32x4.replace_lane 3
         local.tee $34
         local.get $17
         f32x4.mul
         local.get $53
         local.get $18
         i32.const 12
         i32.and
         i32.const 2
         i32.shl
         i32.add
         v128.load
         local.tee $17
         f32x4.add
         i32x4.trunc_sat_f32x4_u
         v128.const i32x4 0x000000ff 0x000000ff 0x000000ff 0x000000ff
         i32x4.min_u
         i32.const 16
         i32x4.shl
         local.get $34
         local.get $16
         f32x4.mul
         local.get $17
         f32x4.add
         i32x4.trunc_sat_f32x4_u
         v128.const i32x4 0x000000ff 0x000000ff 0x000000ff 0x000000ff
         i32x4.min_u
         i32.const 8
         i32x4.shl
         v128.or
         v128.or
         local.tee $16
         local.get $16
         i8x16.shuffle 12 13 14 15 8 9 10 11 4 5 6 7 0 1 2 3
         local.tee $17
         v128.const i32x4 0x00ff0000 0x00ff0000 0x00ff0000 0x00ff0000
         v128.xor
         local.set $34
         local.get $18
         i32.const 2
         i32.shl
         local.tee $22
         local.get $50
         i32.add
         local.get $16
         v128.store
         local.get $22
         local.get $51
         i32.add
         local.get $16
         v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
         v128.xor
         v128.store
         local.get $0
         i32.const 4
         i32.sub
         local.get $18
         i32.sub
         i32.const 2
         i32.shl
         local.tee $22
         local.get $50
         i32.add
         local.get $34
         v128.store
         local.get $22
         local.get $51
         i32.add
         local.get $17
         v128.const i32x4 0x00ffff00 0x00ffff00 0x00ffff00 0x00ffff00
         v128.xor
         v128.store
         local.get $23
         if
          local.get $29
          local.get $18
          local.get $9
          i32.sub
          local.tee $18
          i32.const 2
          i32.shl
          i32.add
          local.get $16
          v128.store
          local.get $15
          local.get $52
          i32.const 4
          i32.sub
          local.get $18
          i32.sub
          i32.const 2
          i32.shl
          i32.add
          local.get $34
          v128.store
         end
        else
         loop $for-loop|24
          local.get $12
          local.get $18
          i32.gt_s
          if
           local.get $26
           local.get $18
           f32.convert_i32_s
           f32.const 0.5
           f32.add
           f32.sub
           local.tee $64
           local.get $64
           f32.mul
           local.get $63
           f32.mul
           local.get $62
           f32.add
           i32.trunc_sat_f32_s
           local.tee $22
           i32.const 127
           i32.gt_s
           if
            i32.const 127
            local.set $22
           end
           local.get $18
           i32.const 2
           i32.shl
           local.tee $54
           local.get $50
           i32.add
           i32.const 255
           local.get $22
           i32.const 0
           local.get $22
           i32.const 0
           i32.ge_s
           select
           i32.const 2
           i32.shl
           i32.const 12288
           i32.add
           f32.load
           local.tee $11
           local.get $64
           f32.mul
           local.get $53
           local.get $18
           i32.const 15
           i32.and
           i32.const 2
           i32.shl
           i32.add
           f32.load
           local.tee $64
           f32.add
           i32.trunc_sat_f32_s
           local.tee $22
           local.get $22
           i32.const 255
           i32.gt_s
           select
           i32.const 0
           local.get $22
           i32.const 0
           i32.ge_s
           select
           local.tee $22
           i32.const 16
           i32.shl
           i32.const -16777088
           i32.or
           local.tee $55
           i32.const 255
           local.get $11
           local.get $60
           f32.mul
           local.get $64
           f32.add
           i32.trunc_sat_f32_s
           local.tee $56
           local.get $56
           i32.const 255
           i32.gt_s
           select
           i32.const 0
           local.get $56
           i32.const 0
           i32.ge_s
           select
           local.tee $56
           i32.const 8
           i32.shl
           local.tee $57
           i32.or
           local.tee $58
           i32.store
           local.get $0
           i32.const 1
           i32.sub
           local.get $18
           i32.sub
           i32.const 2
           i32.shl
           local.tee $59
           local.get $50
           i32.add
           i32.const 255
           local.get $22
           i32.sub
           i32.const 16
           i32.shl
           i32.const -16777088
           i32.or
           local.tee $22
           local.get $57
           i32.or
           local.tee $57
           i32.store
           local.get $51
           local.get $54
           i32.add
           i32.const 255
           local.get $56
           i32.sub
           i32.const 8
           i32.shl
           local.tee $54
           local.get $55
           i32.or
           i32.store
           local.get $51
           local.get $59
           i32.add
           local.get $22
           local.get $54
           i32.or
           i32.store
           local.get $23
           if
            local.get $29
            local.get $18
            local.get $9
            i32.sub
            local.tee $22
            i32.const 2
            i32.shl
            i32.add
            local.get $58
            i32.store
            local.get $15
            local.get $52
            i32.const 1
            i32.sub
            local.get $22
            i32.sub
            i32.const 2
            i32.shl
            i32.add
            local.get $57
            i32.store
           end
           local.get $18
           i32.const 1
           i32.add
           local.set $18
           br $for-loop|24
          end
         end
        end
       end
       local.get $23
       if
        local.get $52
        i32.const 2
        i32.shl
        local.tee $18
        local.get $29
        i32.add
        local.set $29
        local.get $36
        local.get $52
        i32.add
        local.set $36
        local.get $15
        local.get $18
        i32.add
        local.set $15
       end
      end
      local.get $19
      i32.const 1
      i32.add
      local.set $19
      br $for-loop|20
     end
    end
    local.get $10
    i32.const 2
    i32.shl
    local.tee $9
    i32.const 10400
    i32.add
    local.get $20
    i32.store
    local.get $9
    i32.const 10416
    i32.add
    local.get $26
    f32.store
    local.get $9
    i32.const 10432
    i32.add
    local.get $25
    f32.store
    local.get $9
    i32.const 10448
    i32.add
    local.get $23
    i32.store
    local.get $23
    i32.eqz
    if
     i32.const 10496
     local.get $48
     local.get $14
     i32.const 2
     i32.shl
     local.tee $9
     memory.copy
     i32.const 10752
     local.get $49
     local.get $9
     memory.copy
     i32.const -1
     local.set $10
    end
   end
  end
  local.get $14
  i32.const 0
  i32.gt_s
  i32.const 0
  local.get $14
  local.get $32
  i32.lt_s
  i32.const 0
  local.get $47
  select
  select
  if
   local.get $0
   local.get $14
   i32.sub
   i32.const 2
   i32.shl
   local.set $12
   local.get $14
   local.set $9
   loop $for-loop|25
    local.get $9
    local.get $32
    i32.lt_s
    if
     local.get $0
     local.get $9
     i32.mul
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.tee $15
     local.get $14
     call $assembly/index/fillRowPixel
     local.get $12
     local.get $15
     i32.add
     local.get $14
     call $assembly/index/fillRowPixel
     local.get $1
     i32.const 1
     i32.sub
     local.get $9
     i32.sub
     local.get $0
     i32.mul
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.tee $15
     local.get $14
     call $assembly/index/fillRowPixel
     local.get $12
     local.get $15
     i32.add
     local.get $14
     call $assembly/index/fillRowPixel
     local.get $9
     i32.const 1
     i32.add
     local.set $9
     br $for-loop|25
    end
   end
  end
  local.get $31
  i32.eqz
  local.get $0
  local.get $14
  i32.sub
  local.get $14
  i32.sub
  local.tee $9
  i32.const 0
  i32.gt_s
  i32.and
  if
   i32.const 0
   local.set $18
   loop $for-loop|26
    local.get $18
    local.get $32
    i32.lt_s
    if
     local.get $33
     local.get $18
     i32.const 2
     i32.shl
     i32.add
     i32.load
     local.set $12
     local.get $0
     local.get $18
     i32.mul
     local.get $14
     i32.add
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.set $15
     local.get $38
     if (result i32)
      local.get $15
      i32.load
      local.get $12
      i32.eq
     else
      i32.const 0
     end
     i32.eqz
     if
      local.get $1
      i32.const 1
      i32.sub
      local.get $18
      i32.sub
      local.get $0
      i32.mul
      local.get $14
      i32.add
      i32.const 2
      i32.shl
      i32.const 85056
      i32.add
      local.set $19
      local.get $12
      i32x4.splat
      local.set $13
      local.get $30
      local.get $18
      i32.const 2
      i32.shl
      i32.add
      i32.load
      local.tee $22
      i32x4.splat
      local.set $16
      block $assembly/index/fillDualRowPixel|inlined.0
       local.get $9
       i32.const 4
       i32.lt_s
       if
        i32.const 0
        local.set $20
        loop $for-loop|27
         local.get $9
         local.get $20
         i32.gt_s
         if
          local.get $20
          i32.const 2
          i32.shl
          local.tee $23
          local.get $15
          i32.add
          local.get $12
          i32.store
          local.get $19
          local.get $23
          i32.add
          local.get $22
          i32.store
          local.get $20
          i32.const 1
          i32.add
          local.set $20
          br $for-loop|27
         end
        end
        br $assembly/index/fillDualRowPixel|inlined.0
       end
       i32.const 0
       local.set $20
       local.get $9
       i32.const -32
       i32.and
       i32.const 2
       i32.shl
       local.set $12
       loop $while-continue|28
        local.get $12
        local.get $20
        i32.gt_u
        if
         local.get $15
         local.get $20
         i32.add
         local.tee $22
         local.get $13
         v128.store
         local.get $22
         local.get $13
         v128.store offset=16
         local.get $22
         local.get $13
         v128.store offset=32
         local.get $22
         local.get $13
         v128.store offset=48
         local.get $22
         local.get $13
         v128.store offset=64
         local.get $22
         local.get $13
         v128.store offset=80
         local.get $22
         local.get $13
         v128.store offset=96
         local.get $22
         local.get $13
         v128.store offset=112
         local.get $19
         local.get $20
         i32.add
         local.tee $22
         local.get $16
         v128.store
         local.get $22
         local.get $16
         v128.store offset=16
         local.get $22
         local.get $16
         v128.store offset=32
         local.get $22
         local.get $16
         v128.store offset=48
         local.get $22
         local.get $16
         v128.store offset=64
         local.get $22
         local.get $16
         v128.store offset=80
         local.get $22
         local.get $16
         v128.store offset=96
         local.get $22
         local.get $16
         v128.store offset=112
         local.get $20
         i32.const 128
         i32.add
         local.set $20
         br $while-continue|28
        end
       end
       local.get $9
       i32.const -4
       i32.and
       i32.const 2
       i32.shl
       local.set $12
       loop $while-continue|29
        local.get $12
        local.get $20
        i32.gt_u
        if
         local.get $15
         local.get $20
         i32.add
         local.get $13
         v128.store
         local.get $19
         local.get $20
         i32.add
         local.get $16
         v128.store
         local.get $20
         i32.const 16
         i32.add
         local.set $20
         br $while-continue|29
        end
       end
       local.get $9
       i32.const 3
       i32.and
       if
        local.get $9
        i32.const 4
        i32.sub
        i32.const 2
        i32.shl
        local.tee $12
        local.get $15
        i32.add
        local.get $13
        v128.store
        local.get $12
        local.get $19
        i32.add
        local.get $16
        v128.store
       end
      end
     end
     local.get $18
     i32.const 1
     i32.add
     local.set $18
     br $for-loop|26
    end
   end
  end
  local.get $1
  local.get $14
  i32.sub
  local.tee $15
  local.get $14
  i32.gt_s
  local.get $28
  i32.const 0
  i32.gt_s
  i32.and
  if
   local.get $0
   local.get $28
   i32.sub
   local.set $18
   local.get $28
   i32.const -4
   i32.and
   local.set $19
   local.get $14
   local.set $9
   loop $for-loop|30
    local.get $9
    local.get $15
    i32.lt_s
    if
     local.get $0
     local.get $9
     i32.mul
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.tee $20
     local.get $18
     i32.const 2
     i32.shl
     i32.add
     local.set $22
     i32.const 0
     local.set $12
     loop $for-loop|31
      local.get $12
      local.get $19
      i32.lt_s
      if
       local.get $12
       i32.const 2
       i32.shl
       local.tee $23
       local.get $20
       i32.add
       local.get $23
       local.get $27
       i32.add
       v128.load
       v128.store
       local.get $22
       local.get $23
       i32.add
       local.get $23
       local.get $24
       i32.add
       v128.load
       v128.store
       local.get $12
       i32.const 4
       i32.add
       local.set $12
       br $for-loop|31
      end
     end
     local.get $19
     local.get $28
     i32.lt_s
     if
      local.get $28
      i32.const 4
      i32.ge_s
      if
       local.get $28
       i32.const 4
       i32.sub
       i32.const 2
       i32.shl
       local.tee $12
       local.get $20
       i32.add
       local.get $12
       local.get $27
       i32.add
       v128.load
       v128.store
       local.get $12
       local.get $22
       i32.add
       local.get $12
       local.get $24
       i32.add
       v128.load
       v128.store
      else
       loop $for-loop|32
        local.get $12
        local.get $28
        i32.lt_s
        if
         local.get $12
         i32.const 2
         i32.shl
         local.tee $23
         local.get $20
         i32.add
         local.get $23
         local.get $27
         i32.add
         i32.load
         i32.store
         local.get $22
         local.get $23
         i32.add
         local.get $23
         local.get $24
         i32.add
         i32.load
         i32.store
         local.get $12
         i32.const 1
         i32.add
         local.set $12
         br $for-loop|32
        end
       end
      end
     end
     local.get $9
     i32.const 1
     i32.add
     local.set $9
     br $for-loop|30
    end
   end
  end
  i32.const 84994
  local.get $37
  i32.const 2
  i32.shl
  local.tee $9
  i32.const -64
  i32.sub
  local.tee $12
  i32.store
  i32.const 85010
  local.get $0
  i32.store
  i32.const 85014
  i32.const 0
  local.get $1
  i32.sub
  i32.store
  i32.const 85026
  local.get $9
  i32.store
  i32.const 0
  local.get $0
  i32.store
  i32.const 4
  local.get $1
  i32.store
  i32.const 8
  local.get $14
  i32.store
  i32.const 12
  local.get $32
  i32.store
  i32.const 48
  local.get $28
  i32.store
  i32.const 96
  local.get $10
  i32.store
  i32.const 16
  local.get $7
  i32.store
  i32.const 20
  local.get $39
  i32.store
  i32.const 24
  local.get $6
  f32.store
  i32.const 36
  local.get $5
  f32.store
  i32.const 60
  local.get $8
  i32.store
  i32.const 64
  local.get $2
  f32.store
  i32.const 68
  local.get $3
  f32.store
  i32.const 72
  local.get $4
  f32.store
  i32.const 100
  local.get $12
  i32.store
  i32.const 104
  local.get $26
  f32.store
  i32.const 108
  local.get $25
  f32.store
  i32.const 112
  local.get $46
  i32.store
  local.get $12
 )
)
