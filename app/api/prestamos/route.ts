import { NextRequest, NextResponse } from "next/server"
import { getServerSession } from "next-auth/next"
import { authOptions } from "@/lib/auth"
import { prisma } from "@/lib/db"

export const dynamic = "force-dynamic"

// ✅ GET: Obtener préstamos agrupados por cliente
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) {
      return NextResponse.json({ error: "No autorizado" }, { status: 401 })
    }

    const { searchParams } = new URL(request.url)
    const conSaldo = searchParams.get("conSaldo") === "true"

    // 🔹 Obtener préstamos activos con cliente y pagos
    const prestamos = await prisma.prestamo.findMany({
      where: { estado: "ACTIVO" },
      include: {
        cliente: true,
        pagos: { orderBy: { fecha: "desc" } },
      },
      orderBy: [{ fechaInicio: "desc" }],
    })

    // 🔹 Procesar cálculos de saldo
    const prestamosConSaldo = prestamos.map(prestamo => {
      const totalPagado = prestamo.pagos.reduce(
        (sum, pago) => sum + parseFloat(pago.monto.toString()),
        0
      )
      const montoTotal =
        parseFloat(prestamo.monto.toString()) +
        (parseFloat(prestamo.monto.toString()) *
          parseFloat(prestamo.interes.toString())) /
          100
      const saldoPendiente = montoTotal - totalPagado
      const cuotasPagadas = prestamo.pagos.length

      const fechaCreacion = prestamo.createdAt || prestamo.fechaInicio
      const fechaUltimoPago =
        prestamo.pagos.length > 0 ? prestamo.pagos[0].fecha : null
      const fechaActividadReciente =
        fechaUltimoPago && new Date(fechaUltimoPago) > new Date(fechaCreacion)
          ? fechaUltimoPago
          : fechaCreacion

      return {
        ...prestamo,
        saldoPendiente,
        cuotasPagadas,
        montoTotal,
        fechaActividadReciente,
      }
    })

    // 🔹 Agrupar préstamos por cliente
    const clientesConPrestamos = new Map()

    prestamosConSaldo.forEach(prestamo => {
      const clienteId = prestamo.cliente.id
      if (!clientesConPrestamos.has(clienteId)) {
        clientesConPrestamos.set(clienteId, {
          cliente: prestamo.cliente,
          prestamos: [],
          saldoTotalPendiente: 0,
          montoTotalPrestado: 0,
          cuotasTotalesPagadas: 0,
          fechaActividadReciente: prestamo.fechaActividadReciente,
        })
      }

      const clienteData = clientesConPrestamos.get(clienteId)
      clienteData.prestamos.push(prestamo)
      clienteData.saldoTotalPendiente += prestamo.saldoPendiente
      clienteData.montoTotalPrestado += parseFloat(prestamo.monto.toString())
      clienteData.cuotasTotalesPagadas += prestamo.cuotasPagadas

      // Actualizar fecha de actividad más reciente
      if (
        new Date(prestamo.fechaActividadReciente) >
        new Date(clienteData.fechaActividadReciente)
      ) {
        clienteData.fechaActividadReciente = prestamo.fechaActividadReciente
      }
    })

    // 🔹 Convertir en array y filtrar si se pide conSaldo
    const clientesArray = Array.from(clientesConPrestamos.values())
    const resultado = conSaldo
      ? clientesArray.filter(c => c.saldoTotalPendiente > 0)
      : clientesArray

    return NextResponse.json(resultado)
  } catch (error) {
    console.error("❌ Error en GET /api/prestamos:", error)
    return NextResponse.json(
      { error: "Error interno del servidor" },
      { status: 500 }
    )
  }
}

// ✅ POST: Crear préstamo
export async function POST(request: NextRequest) {
  try {
    console.log("POST /api/prestamos - Iniciando creación de préstamo")

    const session = await getServerSession(authOptions)
    let userId = session?.user?.id || "admin"

    // 🔹 Validar existencia de usuario
    const userExists = await prisma.user.findUnique({ where: { id: userId } })

    if (!userExists) {
      console.warn(`⚠️ Usuario con ID ${userId} no encontrado. Usando admin.`)

      const admin = await prisma.user.upsert({
        where: { email: "admin@cobranza.com" },
        update: {},
        create: {
          email: "admin@cobranza.com",
          password: "",
          firstName: "ADMIN",
          lastName: "System",
          role: "ADMINISTRADOR",
          isActive: true,
        },
      })
      userId = admin.id
    }

    const body = await request.json()
    console.log("📦 Datos recibidos:", body)

    const {
      clienteId,
      monto,
      interes,
      tipoPago = "DIARIO",
      cuotas,
      fechaInicio,
      observaciones,
      tipoCredito = "EFECTIVO",
      diasGracia = 0,
      moraCredito = 0,
      microseguroTipo = "NINGUNO",
      microseguroValor = 0,
      microseguroTotal = 0,
    } = body

    // 🔹 Validar campos requeridos
    if (!clienteId || !monto || interes === undefined || !cuotas || !fechaInicio) {
      return NextResponse.json(
        { error: "Faltan campos obligatorios" },
        { status: 400 }
      )
    }

    const montoNum = parseFloat(monto)
    const interesNum = parseFloat(interes)
    const cuotasNum = parseInt(cuotas)
    const diasGraciaNum = parseInt(diasGracia)
    const moraCreditoNum = parseFloat(moraCredito)
    const microseguroValorNum = parseFloat(microseguroValor)
    const microseguroTotalNum = parseFloat(microseguroTotal)

    const clienteExistente = await prisma.cliente.findUnique({
      where: { id: clienteId },
    })

    if (!clienteExistente) {
      return NextResponse.json(
        { error: "Cliente no encontrado" },
        { status: 404 }
      )
    }

    // 🔹 Calcular valores del préstamo
    const interesTotal = (montoNum * interesNum) / 100
    const montoTotal = montoNum + interesTotal
    const valorCuota = montoTotal / cuotasNum

    const fechaFin = new Date(fechaInicio)
    const diasPorTipo = {
      DIARIO: 1,
      SEMANAL: 7,
      QUINCENAL: 15,
      MENSUAL: 30,
      TRIMESTRAL: 90,
      SEMESTRAL: 180,
      ANUAL: 365,
    }

    const diasAgregar = cuotasNum * (diasPorTipo[tipoPago as keyof typeof diasPorTipo] || 1)
    fechaFin.setDate(fechaFin.getDate() + diasAgregar)

    // 🔹 Crear el préstamo
    const prestamo = await prisma.prestamo.create({
      data: {
        clienteId,
        userId,
        monto: montoNum,
        interes: interesNum,
        tipoPago,
        cuotas: cuotasNum,
        valorCuota,
        fechaInicio: new Date(fechaInicio),
        fechaFin,
        observaciones: observaciones?.trim() || null,
        tipoCredito,
        interesTotal,
        diasGracia: diasGraciaNum,
        moraCredito: moraCreditoNum,
        microseguroTipo,
        microseguroValor: microseguroValorNum,
        microseguroTotal: microseguroTotalNum,
      },
      include: { cliente: true },
    })

    console.log("✅ Préstamo creado exitosamente con ID:", prestamo.id)

    return NextResponse.json({
      message: "Préstamo creado exitosamente",
      prestamo,
    })
  } catch (error: any) {
    console.error("❌ Error general al crear préstamo:", error)
    return NextResponse.json(
      {
        error: "Error interno del servidor",
        message: error?.message || "Error desconocido",
      },
      { status: 500 }
    )
  }
}
