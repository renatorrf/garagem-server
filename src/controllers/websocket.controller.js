const { io } = require("../app");

const usuarioInRoom = [];
const usuarioFinalizacao = [];

io.on("connection", (socket) =>{
    console.log("Dispositivo registrado no servidor, ID: " + socket.id);

    socket.on("user-connected", (user) => {
        console.log("Dispositivo Efetuou login: "+ user);
    });

    socket.on("disconnect", () => {
        console.log("Dispositivo Desconectado, ID:" + socket.id);
        // Adicione aqui qualquer código que deseja executar quando a conexão for perdida
    //   usuarioNaArena.splice(0,1).filter(row => row.socket_id == socket.id);
    //   usuarioFinalizacao.splice(0,1).filter(row => row.socket_id == socket.id); 
    });

    socket.on("logadoNoSistema", (data) => { //(data, callback) se quiser dar calback na camada

        const userInRoom = usuarioInRoom.find(row => row.usuario == data.usuario);

        if(data.usuario === undefined){
            //nao executa nada se for undefined
        }else{
            if (userInRoom) {
                userInRoom.socket_id = socket.id;
                userInRoom.room = data.room;
            } else {
                usuarioInRoom.push({
                    room: data.room,
                    usuario: data.usuario,
                    socket_id: socket.id
                });
            }
            socket.join(data.room);
            console.log(usuarioInRoom);
        }
    });

    socket.on("exitSistema", (data) =>{
        console.log("leave",data);
        socket.leave(data.room);
    });
    
    socket.on("atualizacaoTarefa", ( data ) =>{

        console.log( data );

        io.to(data.room).emit("refresh", (data));
    });

    socket.on("exitTelaTarefa", (data) =>{
        console.log("leave",data);
        socket.leave(data.room);
    });

    socket.on("socketFinalizaHorarioArena", ( data ) =>{

        console.log(data);

        const userInRoom = usuarioFinalizacao.find(row => row.usuario == data.usuario);


        if (userInRoom) {
            userInRoom.socket_id = socket.id;
            userInRoom.room = data.room;
        } else {
            usuarioFinalizacao.push({
                room: data.room,
                usuario: data.usuario,
                socket_id: socket.id
            });
        }
        socket.join(data.room);
        console.log(usuarioFinalizacao);
    });

    socket.on("atualizacaoFinalizacao", ( data ) =>{

        console.log( data );

        io.to(data.room).emit("refreshHorario", (data.room));
    });

    socket.on("exitFechamento", (data) =>{
        console.log("leave",data);
        socket.leave(data.room);
    });
    
});