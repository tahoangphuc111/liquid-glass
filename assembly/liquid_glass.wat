(module
 (type $0 (func))
 (type $1 (func (param i32 i32 f32 f32 f32 f32 f32 i32 i32) (result i32)))
 (global $assembly/index/tempHeight (mut f32) (f32.const 0))
 (global $assembly/index/tempDerivative (mut f32) (f32.const 0))
 (memory $0 10 10)
 (export "initTables" (func $assembly/index/initTables))
 (export "generateDisplacementBmp" (func $assembly/index/generateDisplacementBmp))
 (export "memory" (memory $0))
 (func $assembly/index/initTables
  (local $0 f32)
  (local $1 i32)
  (local $2 i32)
  (local $3 i32)
  (local $4 i32)
  (local $5 f32)
  (local $6 f32)
  (local $7 f32)
  (local $8 f32)
  (local $9 f32)
  (local $10 f32)
  (local $11 f32)
  (local $12 f32)
  loop $for-loop|0
   local.get $1
   i32.const 4
   i32.lt_u
   if
    local.get $1
    i32.const 1536
    i32.mul
    i32.const 1024
    i32.add
    local.set $3
    i32.const 1
    local.set $2
    loop $for-loop|1
     local.get $2
     i32.const 127
     i32.lt_s
     if
      local.get $2
      f32.convert_i32_s
      f32.const 127
      f32.div
      local.set $7
      local.get $1
      if
       local.get $1
       i32.const 1
       i32.eq
       if
        f32.const 1
        f32.const 1
        local.get $7
        f32.sub
        local.tee $0
        local.get $0
        f32.mul
        local.tee $5
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
        local.tee $5
        global.set $assembly/index/tempHeight
        local.get $0
        local.get $5
        f32.div
        global.set $assembly/index/tempDerivative
       else
        local.get $1
        i32.const 2
        i32.eq
        if
         f32.const 0
         f32.const 1
         local.get $7
         local.get $7
         f32.const 1
         f32.gt
         select
         local.get $7
         f32.const 0
         f32.lt
         select
         global.set $assembly/index/tempHeight
         f32.const 1
         f32.const 0
         local.get $7
         f32.const 1
         f32.lt
         local.get $7
         f32.const 0
         f32.gt
         i32.and
         select
         global.set $assembly/index/tempDerivative
        else
         f32.const 1
         local.get $7
         f32.const 1
         local.get $7
         f32.sub
         f32.mul
         local.tee $0
         f32.const 16
         f32.mul
         f32.const 5
         local.get $0
         f32.const 4
         f32.mul
         f32.sub
         f32.div
         local.tee $6
         local.get $6
         f32.mul
         local.tee $5
         f32.sub
         f32.const 0
         f64.const 1
         local.get $5
         f64.promote_f32
         f64.sub
         f64.const 0
         f64.gt
         select
         f32.sqrt
         local.set $8
         local.get $7
         local.get $7
         f32.mul
         local.tee $9
         f32.const 3
         local.get $7
         local.get $7
         f32.add
         local.tee $10
         f32.sub
         f32.mul
         local.get $0
         local.get $0
         f32.mul
         local.tee $5
         f32.const 0.15000000596046448
         f32.mul
         local.get $6
         f32.mul
         f32.sub
         local.set $11
         local.get $0
         f32.const 6
         f32.mul
         local.get $0
         local.get $0
         f32.add
         f32.const 1
         local.get $10
         f32.sub
         local.tee $10
         f32.mul
         local.get $6
         f32.mul
         local.get $5
         f32.const 3.1415927410125732
         f32.mul
         local.get $8
         local.get $8
         f32.neg
         local.get $7
         f32.const 0.5
         f32.le
         select
         f32.mul
         f32.add
         f32.const 0.15000000596046448
         f32.mul
         f32.sub
         local.set $8
         local.get $7
         f32.const 0.5
         f32.lt
         if (result f32)
          f32.const 1
          local.get $10
          local.get $10
          f32.mul
          local.tee $12
          local.get $12
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
          local.tee $6
          f32.sqrt
          local.set $0
          local.get $10
          local.get $10
          f32.add
          local.get $12
          f32.mul
          local.get $0
          local.get $6
          f32.mul
          f32.div
         else
          f32.const 1
          local.set $0
          f32.const 0
         end
         local.get $0
         f32.const 1
         local.get $7
         f32.const 6
         f32.mul
         f32.const -15
         f32.add
         local.get $7
         f32.mul
         f32.const 10
         f32.add
         local.get $9
         f32.mul
         local.get $7
         f32.mul
         local.tee $7
         f32.sub
         local.tee $9
         f32.mul
         local.get $11
         local.get $7
         f32.mul
         f32.add
         global.set $assembly/index/tempHeight
         local.get $9
         f32.mul
         local.get $8
         local.get $7
         f32.mul
         f32.add
         local.get $11
         local.get $0
         f32.sub
         local.get $5
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
       local.get $7
       f32.sub
       local.tee $0
       local.get $0
       f32.mul
       local.tee $5
       local.get $5
       f32.mul
       local.tee $6
       f32.sub
       f32.const 1.000000013351432e-10
       f64.const 1
       local.get $6
       f64.promote_f32
       f64.sub
       f64.const 1.000000013351432e-10
       f64.gt
       select
       f32.sqrt
       local.tee $6
       f32.sqrt
       local.tee $7
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
       local.tee $8
       f32.const 0.30000001192092896
       f32.mul
       f32.add
       global.set $assembly/index/tempHeight
       local.get $0
       local.get $5
       f32.const 0.699999988079071
       f32.mul
       f32.const 1
       local.get $7
       local.get $6
       f32.mul
       f32.div
       f32.mul
       f32.const 1
       local.get $8
       f32.div
       f32.const 0.30000001192092896
       f32.mul
       f32.add
       f32.mul
       global.set $assembly/index/tempDerivative
      end
      local.get $2
      i32.const 2
      i32.shl
      local.tee $4
      local.get $3
      i32.add
      global.get $assembly/index/tempDerivative
      local.tee $0
      local.get $0
      f32.mul
      local.tee $5
      f32.store
      local.get $3
      i32.const 512
      i32.add
      local.get $4
      i32.add
      local.get $0
      local.get $5
      f32.const 0.11999999731779099
      f32.mul
      f32.const 1
      f32.add
      f32.sqrt
      f32.sqrt
      f32.div
      local.tee $0
      global.get $assembly/index/tempHeight
      f32.const 0
      global.get $assembly/index/tempHeight
      f32.const 0
      f32.gt
      select
      local.tee $5
      f32.mul
      f32.store
      local.get $3
      i32.const 1024
      i32.add
      local.get $4
      i32.add
      local.get $0
      local.get $5
      local.get $5
      f32.sqrt
      f32.mul
      f32.sqrt
      f32.mul
      f32.store
      local.get $2
      i32.const 1
      i32.add
      local.set $2
      br $for-loop|1
     end
    end
    local.get $3
    f32.const 0
    f32.store
    local.get $3
    f32.const 0
    f32.store offset=512
    local.get $3
    i32.const 1024
    i32.add
    f32.const 0
    f32.store
    local.get $3
    f32.const 0
    f32.store offset=508
    local.get $3
    f32.const 0
    f32.store offset=1020
    local.get $3
    i32.const 1532
    i32.add
    f32.const 0
    f32.store
    local.get $1
    i32.const 1
    i32.add
    local.set $1
    br $for-loop|0
   end
  end
  i32.const 0
  local.set $1
  loop $for-loop|2
   local.get $1
   i32.const 16
   i32.lt_s
   if
    i32.const 0
    local.set $2
    loop $for-loop|3
     local.get $2
     i32.const 16
     i32.lt_s
     if
      local.get $1
      i32.const 4
      i32.shl
      local.get $2
      i32.or
      i32.const 2
      i32.shl
      i32.const 7168
      i32.add
      local.get $2
      f32.convert_i32_s
      f32.const 0.0671105608344078
      f32.mul
      local.get $1
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
      f32.const -0.5
      f32.add
      f32.const 127.5
      f32.add
      f32.store
      local.get $2
      i32.const 1
      i32.add
      local.set $2
      br $for-loop|3
     end
    end
    local.get $1
    i32.const 1
    i32.add
    local.set $1
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
  local.set $2
  loop $for-loop|4
   local.get $2
   i32.const 64
   i32.lt_u
   if
    local.get $2
    i32.const 84992
    i32.add
    i32.const 0
    i32.store8
    local.get $2
    i32.const 1
    i32.add
    local.set $2
    br $for-loop|4
   end
  end
  i32.const 85056
  local.set $1
  loop $while-continue|5
   local.get $1
   i32.const 609344
   i32.lt_u
   if
    local.get $1
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store
    local.get $1
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=16
    local.get $1
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=32
    local.get $1
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store offset=48
    local.get $1
    i32.const -64
    i32.sub
    local.set $1
    br $while-continue|5
   end
  end
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
 )
 (func $assembly/index/generateDisplacementBmp (param $0 i32) (param $1 i32) (param $2 f32) (param $3 f32) (param $4 f32) (param $5 f32) (param $6 f32) (param $7 i32) (param $8 i32) (result i32)
  (local $9 f32)
  (local $10 i32)
  (local $11 f32)
  (local $12 f32)
  (local $13 i32)
  (local $14 i32)
  (local $15 i32)
  (local $16 i32)
  (local $17 i32)
  (local $18 i32)
  (local $19 v128)
  (local $20 v128)
  (local $21 i32)
  (local $22 i32)
  (local $23 i32)
  (local $24 v128)
  (local $25 v128)
  (local $26 f32)
  (local $27 i32)
  (local $28 i32)
  (local $29 v128)
  (local $30 f32)
  (local $31 f32)
  (local $32 f32)
  (local $33 v128)
  (local $34 v128)
  (local $35 f32)
  local.get $8
  i32.const 2
  i32.and
  i32.const 0
  i32.ne
  local.set $28
  local.get $8
  i32.const 4
  i32.and
  i32.const 0
  i32.ne
  local.get $3
  local.get $5
  f32.mul
  local.tee $9
  f32.const 1
  local.get $9
  f32.const 1
  f32.gt
  select
  local.set $32
  local.get $8
  i32.const 1
  i32.and
  local.get $2
  local.get $5
  f32.mul
  local.tee $11
  local.get $0
  i32.const 1
  i32.shr_s
  f32.convert_i32_s
  local.tee $9
  local.get $1
  i32.const 1
  i32.shr_s
  f32.convert_i32_s
  local.tee $2
  local.get $2
  local.get $9
  f32.gt
  select
  local.tee $9
  f32.const -0.5
  f32.add
  f32.ge
  i32.or
  if (result f32)
   local.get $9
  else
   local.get $11
   f32.const 0.5
   f32.add
   f32.const 0
   local.get $11
   f32.const 0
   f32.gt
   select
  end
  local.set $2
  local.get $9
  local.get $2
  local.get $2
  local.get $9
  f32.gt
  select
  local.tee $35
  local.get $32
  local.get $32
  local.get $35
  f32.lt
  select
  f32.const 0.5
  f32.add
  f32.ceil
  i32.trunc_sat_f32_s
  local.tee $8
  i32.const 0
  i32.le_s
  if
   i32.const 1
   local.set $8
  end
  local.get $8
  local.get $9
  i32.trunc_sat_f32_s
  local.tee $10
  i32.gt_s
  if
   local.get $10
   local.set $8
  end
  i32.const 0
  i32.const 64
  local.get $8
  local.get $8
  i32.const 64
  i32.gt_s
  select
  local.get $28
  select
  local.set $8
  local.get $32
  f32.ceil
  i32.trunc_sat_f32_s
  i32.const 1
  i32.add
  local.tee $10
  i32.const 0
  i32.le_s
  if
   i32.const 1
   local.set $10
  end
  i32.const 256
  local.get $10
  local.get $10
  i32.const 256
  i32.gt_s
  select
  local.tee $27
  local.get $32
  f32.const -0.5
  f32.add
  f32.ceil
  i32.trunc_sat_f32_s
  local.tee $10
  i32.const 0
  i32.lt_s
  if
   i32.const 0
   local.set $10
  end
  local.get $10
  local.get $10
  local.get $27
  i32.gt_s
  select
  local.set $14
  i32.const 85056
  local.set $10
  i32.const 131072
  local.get $0
  local.get $1
  i32.mul
  i32.const 3
  i32.add
  i32.const -4
  i32.and
  local.tee $13
  local.get $13
  i32.const 131072
  i32.gt_s
  select
  i32.const 2
  i32.shl
  i32.const 85056
  i32.add
  local.set $13
  loop $while-continue|0
   local.get $10
   local.get $13
   i32.lt_u
   if
    local.get $10
    v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
    v128.store
    local.get $10
    i32.const 16
    i32.add
    local.set $10
    br $while-continue|0
   end
  end
  local.get $32
  f32.const 9.999999974752427e-07
  f32.le
  local.tee $21
  if (result i32)
   i32.const -1
  else
   local.get $4
   local.get $32
   f32.div
   f32.const 1e3
   f32.mul
   f32.const 0.5
   f32.add
   i32.trunc_sat_f32_s
  end
  local.tee $18
  i32.const 20
  i32.load
  i32.ne
  i32.const 16
  i32.load
  local.get $7
  i32.ne
  i32.or
  i32.const 24
  f32.load
  local.get $6
  f32.ne
  i32.or
  local.get $5
  i32.const 36
  f32.load
  f32.sub
  local.tee $2
  f32.neg
  local.get $2
  local.get $2
  f32.const 0
  f32.lt
  select
  f32.const 1.0000000474974513e-03
  f32.gt
  i32.or
  i32.or
  if
   local.get $7
   i32.const 1536
   i32.mul
   i32.const 1024
   i32.add
   local.set $17
   f32.const 1
   f32.const 1
   local.get $6
   f32.div
   local.tee $26
   local.get $26
   f32.mul
   f32.sub
   local.set $12
   f32.const -1
   local.set $9
   f32.const -1
   local.set $2
   i32.const 1
   local.set $13
   i32.const 1
   local.set $15
   i32.const 8192
   f32.const 0
   f32.store
   i32.const 8704
   f32.const 0
   f32.store
   i32.const 1
   local.set $10
   loop $for-loop|1
    local.get $10
    i32.const 127
    i32.lt_s
    if
     local.get $12
     local.get $26
     local.get $12
     local.get $17
     local.get $10
     i32.const 2
     i32.shl
     local.tee $16
     i32.add
     f32.load
     f32.mul
     f32.const 1
     f32.add
     f32.sqrt
     f32.mul
     f32.const 1
     f32.add
     f32.div
     local.tee $11
     local.get $17
     i32.const 512
     i32.add
     local.get $16
     i32.add
     f32.load
     f32.mul
     local.set $31
     local.get $11
     local.get $17
     i32.const 1024
     i32.add
     local.get $16
     i32.add
     f32.load
     f32.mul
     local.set $30
     local.get $16
     i32.const -8192
     i32.sub
     local.get $31
     f32.store
     local.get $16
     i32.const 8704
     i32.add
     local.get $30
     f32.store
     local.get $31
     f32.neg
     local.get $31
     local.get $31
     f32.const 0
     f32.lt
     select
     local.tee $11
     local.get $9
     f32.gt
     if
      local.get $10
      local.set $13
      local.get $11
      local.set $9
     end
     local.get $30
     f32.neg
     local.get $30
     local.get $30
     f32.const 0
     f32.lt
     select
     local.tee $11
     local.get $2
     f32.gt
     if
      local.get $10
      local.set $15
      local.get $11
      local.set $2
     end
     local.get $10
     i32.const 1
     i32.add
     local.set $10
     br $for-loop|1
    end
   end
   i32.const 8700
   f32.const 0
   f32.store
   i32.const 9212
   f32.const 0
   f32.store
   local.get $13
   local.get $15
   local.get $13
   local.get $15
   i32.lt_s
   select
   i32.const -4
   i32.and
   local.get $13
   local.get $15
   local.get $13
   local.get $15
   i32.gt_s
   select
   i32.const 3
   i32.add
   i32.const -4
   i32.and
   local.tee $13
   i32.const 128
   i32.gt_s
   if
    i32.const 128
    local.set $13
   end
   f32.const 0
   local.get $4
   local.get $32
   f32.div
   local.get $21
   select
   f32x4.splat
   local.set $19
   i32.const 2
   i32.shl
   local.set $10
   loop $for-loop|2
    local.get $10
    local.get $13
    i32.const 2
    i32.shl
    i32.lt_u
    if
     local.get $20
     local.get $10
     i32.const -8192
     i32.sub
     v128.load
     local.get $19
     local.get $10
     i32.const 8704
     i32.add
     v128.load
     f32x4.mul
     f32x4.add
     f32x4.abs
     f32x4.max
     local.set $20
     local.get $10
     i32.const 16
     i32.add
     local.set $10
     br $for-loop|2
    end
   end
   local.get $19
   local.get $20
   local.get $20
   local.get $20
   i8x16.shuffle 8 9 10 11 12 13 14 15 0 1 2 3 4 5 6 7
   f32x4.max
   local.tee $19
   local.get $19
   local.get $19
   i8x16.shuffle 4 5 6 7 0 1 2 3 12 13 14 15 8 9 10 11
   f32x4.max
   f32x4.extract_lane 0
   local.tee $12
   f32.const 0
   f32.le
   if
    f32.const 1
    local.set $12
   end
   f32.const 127
   local.get $12
   f32.div
   f32x4.splat
   local.tee $20
   f32x4.mul
   local.set $19
   i32.const 0
   local.set $10
   loop $for-loop|3
    local.get $10
    i32.const 512
    i32.lt_u
    if
     local.get $10
     i32.const 9216
     i32.add
     local.get $10
     i32.const -8192
     i32.sub
     v128.load
     local.get $20
     f32x4.mul
     local.get $10
     i32.const 8704
     i32.add
     v128.load
     local.get $19
     f32x4.mul
     f32x4.add
     v128.store
     local.get $10
     i32.const 16
     i32.add
     local.set $10
     br $for-loop|3
    end
   end
   i32.const 9216
   f32.const 0
   f32.store
   i32.const 9724
   f32.const 0
   f32.store
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
    local.tee $2
    f32.sub
    local.get $2
    f32.const 8
    f32.mul
    f32.div
    local.tee $11
    f32.const 1.2000000476837158
    f32.gt
    if
     f32.const 1.2000000476837158
     local.set $11
    end
    f32.const 0
    local.set $2
    i32.const 1
    local.set $10
    loop $for-loop|4
     local.get $10
     i32.const 127
     i32.lt_s
     if
      local.get $10
      i32.const 2
      i32.shl
      local.tee $13
      i32.const 9216
      i32.add
      f32.load
      local.tee $9
      local.get $11
      local.get $2
      local.get $9
      local.get $9
      f32.add
      f32.sub
      local.get $13
      i32.const 9220
      i32.add
      f32.load
      f32.add
      f32.mul
      f32.sub
      local.tee $2
      f32.const 0
      f32.lt
      if
       f32.const 0
       local.set $2
      end
      f32.const 127
      local.get $2
      local.get $2
      f32.const 127
      f32.gt
      select
      local.set $26
      local.get $9
      local.set $2
      local.get $10
      i32.const 2
      i32.shl
      i32.const 9216
      i32.add
      local.get $26
      f32.store
      local.get $10
      i32.const 1
      i32.add
      local.set $10
      br $for-loop|4
     end
    end
   end
   i32.const 16
   local.get $7
   i32.store
   i32.const 20
   local.get $18
   i32.store
   i32.const 24
   local.get $6
   f32.store
   i32.const 36
   local.get $5
   f32.store
   i32.const 28
   local.get $12
   f32.store
  end
  i32.const 32
  f32.const 1
  local.get $4
  i32.const 28
  f32.load
  local.tee $2
  f32.mul
  local.get $3
  local.get $2
  f32.mul
  local.get $21
  select
  local.tee $2
  local.get $2
  f32.const 0
  f32.le
  select
  f32.store
  f32.const 127
  local.get $32
  f32.div
  local.set $26
  i32.const 0
  local.set $7
  loop $for-loop|5
   local.get $7
   local.get $14
   i32.lt_s
   if
    i32.const 255
    i32.const 255
    local.get $7
    f32.convert_i32_s
    f32.const 0.5
    f32.add
    local.get $26
    f32.mul
    local.tee $3
    i32.trunc_sat_f32_s
    local.tee $10
    i32.const 2
    i32.shl
    i32.const 9216
    i32.add
    f32.load
    local.tee $2
    local.get $3
    local.get $10
    f32.convert_i32_s
    f32.sub
    i32.const 127
    local.get $10
    i32.const 1
    i32.add
    local.tee $10
    local.get $10
    i32.const 127
    i32.ge_s
    select
    i32.const 2
    i32.shl
    i32.const 9216
    i32.add
    f32.load
    local.get $2
    f32.sub
    f32.mul
    f32.add
    f64.promote_f32
    f64.const 128.5
    f64.add
    i32.trunc_sat_f64_s
    local.tee $10
    local.get $10
    i32.const 255
    i32.gt_s
    select
    i32.const 0
    local.get $10
    i32.const 0
    i32.ge_s
    select
    local.tee $15
    i32.sub
    local.set $13
    local.get $28
    i32.eqz
    if
     local.get $7
     i32.const 2
     i32.shl
     local.tee $10
     i32.const 15360
     i32.add
     local.get $15
     i32.const 8
     i32.shl
     i32.const -8388480
     i32.or
     i32.store
     local.get $10
     i32.const 16384
     i32.add
     local.get $13
     i32.const 8
     i32.shl
     i32.const -8388480
     i32.or
     i32.store
    end
    local.get $7
    i32.const 2
    i32.shl
    i32.const 17408
    i32.add
    local.get $15
    i32.const 16
    i32.shl
    i32.const -16744320
    i32.or
    i32.store
    local.get $27
    local.get $7
    i32.sub
    i32.const 2
    i32.shl
    i32.const 18428
    i32.add
    local.get $13
    i32.const 16
    i32.shl
    i32.const -16744320
    i32.or
    i32.store
    local.get $7
    i32.const 1
    i32.add
    local.set $7
    br $for-loop|5
   end
  end
  local.get $14
  local.set $7
  loop $for-loop|6
   local.get $7
   local.get $27
   i32.lt_s
   if
    local.get $28
    i32.eqz
    if
     local.get $7
     i32.const 2
     i32.shl
     local.tee $10
     i32.const 15360
     i32.add
     i32.const -8355712
     i32.store
     local.get $10
     i32.const 16384
     i32.add
     i32.const -8355712
     i32.store
    end
    local.get $7
    i32.const 2
    i32.shl
    i32.const 17408
    i32.add
    i32.const -8355712
    i32.store
    local.get $27
    local.get $7
    i32.sub
    i32.const 2
    i32.shl
    i32.const 18428
    i32.add
    i32.const -8355712
    i32.store
    local.get $7
    i32.const 1
    i32.add
    local.set $7
    br $for-loop|6
   end
  end
  local.get $28
  i32.eqz
  local.get $8
  i32.const 0
  i32.gt_s
  i32.and
  if
   local.get $35
   f32.const 0.5
   f32.add
   local.tee $2
   local.get $2
   f32.mul
   local.tee $12
   local.get $35
   local.get $32
   f32.sub
   f32.const 0
   local.get $32
   local.get $35
   f32.lt
   select
   local.tee $2
   local.get $2
   f32.mul
   local.tee $11
   f32.sub
   local.tee $2
   f32.const 255
   f32.div
   local.set $6
   f32.const 255
   local.get $2
   f32.div
   f32.const 0
   local.get $6
   f32.const 9.99999993922529e-09
   f32.gt
   select
   local.set $9
   i32.const 0
   local.set $7
   loop $for-loop|7
    local.get $7
    i32.const 256
    i32.lt_s
    if
     local.get $35
     local.get $11
     local.get $7
     f32.convert_i32_s
     local.get $6
     f32.mul
     f32.add
     f32.sqrt
     local.tee $5
     f32.sub
     local.tee $4
     f32.const -0.5
     f32.lt
     local.get $4
     local.get $32
     f32.ge
     i32.or
     local.get $5
     f32.const 9.999999974752427e-07
     f32.le
     i32.or
     if
      local.get $7
      i32.const 2
      i32.shl
      i32.const 12288
      i32.add
      f32.const 0
      f32.store
     else
      local.get $7
      i32.const 2
      i32.shl
      i32.const 12288
      i32.add
      local.get $4
      f32.const 0
      local.get $4
      f32.const 0
      f32.gt
      select
      local.get $26
      f32.mul
      local.tee $3
      i32.trunc_sat_f32_s
      local.tee $10
      i32.const 2
      i32.shl
      i32.const 9216
      i32.add
      f32.load
      local.tee $2
      local.get $3
      local.get $10
      f32.convert_i32_s
      f32.sub
      i32.const 127
      local.get $10
      i32.const 1
      i32.add
      local.tee $10
      local.get $10
      i32.const 127
      i32.ge_s
      select
      i32.const 2
      i32.shl
      i32.const 9216
      i32.add
      f32.load
      local.get $2
      f32.sub
      f32.mul
      f32.add
      local.get $4
      f32.const 0.5
      f32.lt
      if (result f32)
       f32.const 0
       f32.const 1
       local.get $4
       f32.const 0.5
       f32.add
       local.tee $2
       local.get $2
       f32.const 1
       f32.gt
       select
       local.get $2
       f32.const 0
       f32.lt
       select
      else
       f32.const 1
      end
      f32.mul
      local.get $5
      f32.div
      f32.store
     end
     local.get $7
     i32.const 1
     i32.add
     local.set $7
     br $for-loop|7
    end
   end
   i32.const 0
   local.set $7
   loop $for-loop|8
    local.get $7
    local.get $8
    i32.lt_s
    if
     local.get $7
     i32.const 2
     i32.shl
     local.tee $10
     i32.const 13312
     i32.add
     local.get $35
     local.get $7
     f32.convert_i32_s
     f32.const 0.5
     f32.add
     f32.sub
     local.tee $2
     f32.store
     local.get $10
     i32.const 14336
     i32.add
     local.get $2
     local.get $2
     f32.mul
     f32.store
     local.get $7
     i32.const 1
     i32.add
     local.set $7
     br $for-loop|8
    end
   end
   local.get $8
   local.get $8
   i32.mul
   i32.const 3
   i32.add
   i32.const -4
   i32.and
   local.set $13
   i32.const 0
   local.set $7
   loop $for-loop|9
    local.get $7
    local.get $13
    i32.lt_s
    if
     local.get $7
     i32.const 2
     i32.shl
     local.tee $10
     i32.const 19456
     i32.add
     v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
     v128.store
     local.get $10
     i32.const 35840
     i32.add
     v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
     v128.store
     local.get $10
     i32.const 52224
     i32.add
     v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
     v128.store
     local.get $10
     i32.const 68608
     i32.add
     v128.const i32x4 0xff808080 0xff808080 0xff808080 0xff808080
     v128.store
     local.get $7
     i32.const 4
     i32.add
     local.set $7
     br $for-loop|9
    end
   end
   local.get $11
   f32x4.splat
   local.set $29
   local.get $12
   f32x4.splat
   local.set $25
   local.get $9
   f32x4.splat
   local.set $24
   i32.const 0
   local.set $13
   loop $for-loop|10
    local.get $8
    local.get $13
    i32.gt_s
    if
     local.get $35
     local.get $13
     f32.convert_i32_s
     f32.const 0.5
     f32.add
     f32.sub
     local.tee $6
     local.get $6
     f32.mul
     local.tee $5
     f32x4.splat
     local.set $34
     local.get $6
     f32x4.splat
     local.set $33
     local.get $8
     local.get $13
     i32.mul
     local.set $22
     i32.const 0
     local.set $7
     local.get $8
     i32.const -4
     i32.and
     local.set $15
     loop $for-loop|11
      local.get $7
      local.get $15
      i32.lt_s
      if
       local.get $7
       i32.const 2
       i32.shl
       local.tee $10
       i32.const 14336
       i32.add
       v128.load
       local.get $34
       f32x4.add
       local.tee $19
       local.get $29
       f32x4.ge
       local.get $19
       local.get $25
       f32x4.lt
       v128.and
       local.tee $20
       v128.any_true
       if
        v128.const i32x4 0xff000080 0xff000080 0xff000080 0xff000080
        v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
        local.get $19
        local.get $29
        f32x4.sub
        local.get $24
        f32x4.mul
        i32x4.trunc_sat_f32x4_u
        v128.const i32x4 0x000000ff 0x000000ff 0x000000ff 0x000000ff
        i32x4.min_u
        local.tee $19
        i32x4.extract_lane 0
        i32.const 2
        i32.shl
        i32.const 12288
        i32.add
        f32.load
        f32x4.splat
        local.get $19
        i32x4.extract_lane 1
        i32.const 2
        i32.shl
        i32.const 12288
        i32.add
        f32.load
        f32x4.replace_lane 1
        local.get $19
        i32x4.extract_lane 2
        i32.const 2
        i32.shl
        i32.const 12288
        i32.add
        f32.load
        f32x4.replace_lane 2
        local.get $19
        i32x4.extract_lane 3
        i32.const 2
        i32.shl
        i32.const 12288
        i32.add
        f32.load
        f32x4.replace_lane 3
        v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
        local.get $20
        v128.bitselect
        local.tee $20
        local.get $10
        i32.const 13312
        i32.add
        v128.load
        f32x4.mul
        local.get $7
        i32.const 12
        i32.and
        local.get $13
        i32.const 15
        i32.and
        i32.const 4
        i32.shl
        i32.or
        i32.const 2
        i32.shl
        i32.const 7168
        i32.add
        v128.load
        local.tee $19
        f32x4.add
        i32x4.trunc_sat_f32x4_u
        v128.const i32x4 0x000000ff 0x000000ff 0x000000ff 0x000000ff
        i32x4.min_u
        i32x4.max_u
        i32.const 16
        i32x4.shl
        v128.const i32x4 0x00000000 0x00000000 0x00000000 0x00000000
        local.get $20
        local.get $33
        f32x4.mul
        local.get $19
        f32x4.add
        i32x4.trunc_sat_f32x4_u
        v128.const i32x4 0x000000ff 0x000000ff 0x000000ff 0x000000ff
        i32x4.min_u
        i32x4.max_u
        i32.const 8
        i32x4.shl
        v128.or
        v128.or
        local.tee $20
        local.get $20
        i8x16.shuffle 12 13 14 15 8 9 10 11 4 5 6 7 0 1 2 3
        local.set $19
        local.get $7
        local.get $22
        i32.add
        i32.const 2
        i32.shl
        local.tee $10
        i32.const 19456
        i32.add
        local.get $20
        v128.store
        local.get $10
        i32.const 52224
        i32.add
        local.get $20
        v128.const i32x4 0x0000ff00 0x0000ff00 0x0000ff00 0x0000ff00
        v128.xor
        v128.store
        local.get $8
        i32.const 4
        i32.sub
        local.get $7
        i32.sub
        local.get $22
        i32.add
        i32.const 2
        i32.shl
        local.tee $10
        i32.const 35840
        i32.add
        local.get $19
        v128.const i32x4 0x00ff0000 0x00ff0000 0x00ff0000 0x00ff0000
        v128.xor
        v128.store
        local.get $10
        i32.const 68608
        i32.add
        local.get $19
        v128.const i32x4 0x00ffff00 0x00ffff00 0x00ffff00 0x00ffff00
        v128.xor
        v128.store
       end
       local.get $7
       i32.const 4
       i32.add
       local.set $7
       br $for-loop|11
      end
     end
     loop $for-loop|12
      local.get $7
      local.get $8
      i32.lt_s
      if
       local.get $7
       i32.const 2
       i32.shl
       local.tee $10
       i32.const 13312
       i32.add
       f32.load
       local.set $4
       local.get $10
       i32.const 14336
       i32.add
       f32.load
       local.get $5
       f32.add
       local.tee $2
       local.get $11
       f32.ge
       local.get $2
       local.get $12
       f32.lt
       i32.and
       if
        local.get $7
        local.get $22
        i32.add
        i32.const 2
        i32.shl
        local.tee $21
        i32.const 19456
        i32.add
        i32.const 255
        i32.const 255
        local.get $2
        local.get $11
        f32.sub
        local.get $9
        f32.mul
        i32.trunc_sat_f32_s
        local.tee $10
        local.get $10
        i32.const 255
        i32.gt_s
        select
        i32.const 2
        i32.shl
        i32.const 12288
        i32.add
        f32.load
        local.tee $3
        local.get $4
        f32.mul
        local.get $7
        i32.const 15
        i32.and
        local.get $13
        i32.const 15
        i32.and
        i32.const 4
        i32.shl
        i32.or
        i32.const 2
        i32.shl
        i32.const 7168
        i32.add
        f32.load
        local.tee $2
        f32.add
        i32.trunc_sat_f32_s
        local.tee $10
        local.get $10
        i32.const 255
        i32.gt_s
        select
        i32.const 0
        local.get $10
        i32.const 0
        i32.ge_s
        select
        local.tee $15
        i32.const 16
        i32.shl
        i32.const -16777088
        i32.or
        local.tee $18
        i32.const 255
        local.get $3
        local.get $6
        f32.mul
        local.get $2
        f32.add
        i32.trunc_sat_f32_s
        local.tee $10
        local.get $10
        i32.const 255
        i32.gt_s
        select
        i32.const 0
        local.get $10
        i32.const 0
        i32.ge_s
        select
        local.tee $17
        i32.const 8
        i32.shl
        local.tee $10
        i32.or
        i32.store
        local.get $8
        i32.const 1
        i32.sub
        local.get $7
        i32.sub
        local.get $22
        i32.add
        i32.const 2
        i32.shl
        local.tee $16
        i32.const 35840
        i32.add
        i32.const 255
        local.get $15
        i32.sub
        i32.const 16
        i32.shl
        i32.const -16777088
        i32.or
        local.tee $15
        local.get $10
        i32.or
        i32.store
        local.get $21
        i32.const 52224
        i32.add
        i32.const 255
        local.get $17
        i32.sub
        i32.const 8
        i32.shl
        local.tee $10
        local.get $18
        i32.or
        i32.store
        local.get $16
        i32.const 68608
        i32.add
        local.get $10
        local.get $15
        i32.or
        i32.store
       end
       local.get $7
       i32.const 1
       i32.add
       local.set $7
       br $for-loop|12
      end
     end
     local.get $13
     i32.const 1
     i32.add
     local.set $13
     br $for-loop|10
    end
   end
  end
  local.get $0
  local.get $8
  i32.sub
  local.tee $16
  local.get $8
  i32.sub
  local.set $23
  local.get $14
  local.get $0
  f32.convert_i32_s
  f32.const 0.5
  f32.mul
  f32.ceil
  i32.trunc_sat_f32_s
  local.tee $7
  local.get $7
  local.get $14
  i32.gt_s
  select
  local.set $22
  local.get $14
  local.get $1
  f32.convert_i32_s
  f32.const 0.5
  f32.mul
  f32.ceil
  i32.trunc_sat_f32_s
  local.tee $7
  local.get $7
  local.get $14
  i32.gt_s
  select
  local.tee $7
  local.get $8
  local.get $7
  local.get $8
  i32.lt_s
  select
  local.set $21
  local.get $8
  i32.const 0
  i32.gt_s
  if
   local.get $8
   i32.const 2
   i32.shl
   local.set $15
   i32.const 0
   local.set $7
   loop $for-loop|13
    local.get $7
    local.get $8
    i32.lt_s
    if
     local.get $0
     local.get $7
     i32.mul
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.tee $10
     local.get $7
     local.get $8
     i32.mul
     i32.const 2
     i32.shl
     local.tee $14
     i32.const 19456
     i32.add
     local.get $15
     memory.copy
     local.get $16
     i32.const 2
     i32.shl
     local.tee $13
     local.get $10
     i32.add
     local.get $14
     i32.const 35840
     i32.add
     local.get $15
     memory.copy
     local.get $1
     i32.const 1
     i32.sub
     local.get $7
     i32.sub
     local.get $0
     i32.mul
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.tee $10
     local.get $14
     i32.const 52224
     i32.add
     local.get $15
     memory.copy
     local.get $10
     local.get $13
     i32.add
     local.get $14
     i32.const 68608
     i32.add
     local.get $15
     memory.copy
     local.get $7
     i32.const 1
     i32.add
     local.set $7
     br $for-loop|13
    end
   end
  end
  local.get $28
  i32.eqz
  local.get $23
  i32.const 0
  i32.gt_s
  i32.and
  if
   i32.const 0
   local.set $10
   loop $for-loop|14
    local.get $10
    local.get $21
    i32.lt_s
    if
     local.get $0
     local.get $10
     i32.mul
     local.get $8
     i32.add
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.set $18
     local.get $1
     i32.const 1
     i32.sub
     local.get $10
     i32.sub
     local.get $0
     i32.mul
     local.get $8
     i32.add
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.set $17
     local.get $10
     i32.const 2
     i32.shl
     local.tee $7
     i32.const 15360
     i32.add
     i32.load
     local.tee $16
     i32x4.splat
     local.set $20
     local.get $7
     i32.const 16384
     i32.add
     i32.load
     local.tee $15
     i32x4.splat
     local.set $19
     i32.const 0
     local.set $7
     local.get $23
     i32.const -4
     i32.and
     local.set $14
     loop $for-loop|15
      local.get $7
      local.get $14
      i32.lt_s
      if
       local.get $7
       i32.const 2
       i32.shl
       local.tee $13
       local.get $18
       i32.add
       local.get $20
       v128.store
       local.get $13
       local.get $17
       i32.add
       local.get $19
       v128.store
       local.get $7
       i32.const 4
       i32.add
       local.set $7
       br $for-loop|15
      end
     end
     loop $for-loop|16
      local.get $7
      local.get $23
      i32.lt_s
      if
       local.get $7
       i32.const 2
       i32.shl
       local.tee $13
       local.get $18
       i32.add
       local.get $16
       i32.store
       local.get $13
       local.get $17
       i32.add
       local.get $15
       i32.store
       local.get $7
       i32.const 1
       i32.add
       local.set $7
       br $for-loop|16
      end
     end
     local.get $10
     i32.const 1
     i32.add
     local.set $10
     br $for-loop|14
    end
   end
  end
  local.get $1
  local.get $8
  i32.sub
  local.tee $18
  local.get $8
  i32.gt_s
  local.get $22
  i32.const 0
  i32.gt_s
  i32.and
  if
   local.get $0
   local.get $22
   i32.sub
   local.set $17
   local.get $27
   local.get $22
   i32.sub
   local.set $16
   loop $for-loop|17
    local.get $8
    local.get $18
    i32.lt_s
    if
     local.get $0
     local.get $8
     i32.mul
     i32.const 2
     i32.shl
     i32.const 85056
     i32.add
     local.tee $15
     local.get $17
     i32.const 2
     i32.shl
     i32.add
     local.set $14
     i32.const 0
     local.set $7
     loop $for-loop|18
      local.get $7
      local.get $22
      i32.lt_s
      if
       local.get $7
       local.get $16
       i32.add
       i32.const 2
       i32.shl
       i32.const 18432
       i32.add
       i32.load
       local.set $13
       local.get $15
       local.get $7
       i32.const 2
       i32.shl
       local.tee $10
       i32.add
       local.get $10
       i32.const 17408
       i32.add
       i32.load
       i32.store
       local.get $10
       local.get $14
       i32.add
       local.get $13
       i32.store
       local.get $7
       i32.const 1
       i32.add
       local.set $7
       br $for-loop|18
      end
     end
     local.get $8
     i32.const 1
     i32.add
     local.set $8
     br $for-loop|17
    end
   end
  end
  i32.const 84994
  local.get $0
  local.get $1
  i32.mul
  i32.const 2
  i32.shl
  local.tee $8
  i32.const -64
  i32.sub
  local.tee $7
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
  local.get $8
  i32.store
  local.get $7
 )
)
